/**
 * Web dashboard server for viewing test results
 */

import express from 'express';
import { readFile, readdir, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { BrowserbaseProvider } from '../browser/browserbase-provider.js';
import { EvidenceCapture } from '../agent/evidence-capture.js';
import { Evaluator } from '../agent/evaluator.js';
import { QAAgent } from '../agent/qa-agent.js';
import { loadConfig } from '../config/config-loader.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class DashboardServer {
  private app: express.Application;
  private port: number;
  private outputDir: string;

  constructor(port: number = 3000, outputDir: string = './output') {
    this.app = express();
    this.port = port;
    this.outputDir = resolve(outputDir);

    this.app.use(express.json());
    
    // Content Security Policy to prevent extension injection
    this.app.use((req, res, next) => {
      // Block Chrome extensions from injecting scripts
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self';"
      );
      
      // Enable CORS for development
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type');
      if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
      }
      next();
    });

    // Serve dashboard HTML
    const publicDir = join(__dirname, 'public');
    this.app.get('/', (req, res) => {
      res.sendFile(join(publicDir, 'index.html'));
    });
    
    // Serve static assets from public directory
    this.app.use('/static', express.static(publicDir));

    // API: Get all reports
    this.app.get('/api/reports', async (req, res) => {
      try {
        if (!existsSync(this.outputDir)) {
          return res.json([]);
        }

        const files = await readdir(this.outputDir);
        const reportFiles = files.filter((f) => f.startsWith('report-') && f.endsWith('.json'));

        const reports = await Promise.all(
          reportFiles.map(async (file) => {
            try {
              const content = await readFile(join(this.outputDir, file), 'utf-8');
              const report = JSON.parse(content);
              return {
                ...report,
                filename: file,
              };
            } catch (error) {
              return null;
            }
          })
        );

        res.json(reports.filter((r) => r !== null).reverse()); // Most recent first
      } catch (error) {
        res.status(500).json({ error: 'Failed to load reports' });
      }
    });

    // API: Get single report
    this.app.get('/api/reports/:filename', async (req, res) => {
      try {
        const filename = req.params.filename;
        const content = await readFile(join(this.outputDir, filename), 'utf-8');
        const report = JSON.parse(content);
        res.json(report);
      } catch (error) {
        res.status(404).json({ error: 'Report not found' });
      }
    });

    // API: Get screenshot
    this.app.get('/api/screenshots/:filename', async (req, res) => {
      try {
        const filename = req.params.filename;
        const screenshotPath = join(this.outputDir, 'screenshots', filename);
        
        // Check if file exists
        if (!existsSync(screenshotPath)) {
          return res.status(404).json({ error: 'Screenshot not found' });
        }
        
        // Set proper content type
        res.type('image/png');
        res.sendFile(screenshotPath);
      } catch (error) {
        res.status(404).json({ error: 'Screenshot not found' });
      }
    });

    // API: Run test on game URL
    this.app.post('/api/test', async (req, res) => {
      const { gameUrl } = req.body;
      
      if (!gameUrl || typeof gameUrl !== 'string') {
        return res.status(400).json({ error: 'Invalid game URL provided' });
      }

      // Validate URL format
      try {
        new URL(gameUrl);
      } catch {
        return res.status(400).json({ error: 'Invalid URL format' });
      }

      try {
        // Run test asynchronously
        this.runTestAsync(gameUrl).catch(error => {
          console.error('Test execution error:', error);
        });

        // Return immediately with success
        res.json({ 
          status: 'started', 
          message: 'Test started successfully',
          gameUrl 
        });
      } catch (error) {
        res.status(500).json({ 
          error: 'Failed to start test',
          message: error instanceof Error ? error.message : String(error)
        });
      }
    });

    // API: Get test status (for polling)
    this.app.get('/api/test/status', (req, res) => {
      res.json({ 
        running: this.testRunning,
        currentTest: this.currentTest,
        phase: this.currentPhase,
        // Include error info if phase is error
        error: this.currentPhase === 'error' ? 'Test execution failed' : undefined
      });
    });
  }

  private testRunning = false;
  private currentTest: { gameUrl: string; startTime: number } | null = null;
  private currentPhase: string = 'idle'; // 'idle' | 'load' | 'capture' | 'interact' | 'analyze' | 'report' | 'complete'

  private async runTestAsync(gameUrl: string): Promise<void> {
    if (this.testRunning) {
      throw new Error('A test is already running');
    }

    this.testRunning = true;
    this.currentTest = { gameUrl, startTime: Date.now() };
    this.currentPhase = 'load';

    try {
      // Phase 1: Load configuration
      const config = await loadConfig();
      
      // Phase 2: Initialize browser
      this.currentPhase = 'load';
      const browserProvider = new BrowserbaseProvider();
      const session = await browserProvider.createSession();
      
      // Initialize components
      const evidenceCapture = new EvidenceCapture(this.outputDir);
      const evaluator = new Evaluator();
      
      // Create agent
      const agent = new QAAgent(session, config, evidenceCapture, evaluator);
      
      // Phase 3: Load game
      this.currentPhase = 'load';
      await session.navigate(gameUrl);
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Phase 4: Capture evidence
      this.currentPhase = 'capture';
      await evidenceCapture.initialize();
      await evidenceCapture.captureScreenshot(session, 'initial-load');
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Phase 5: Interact
      this.currentPhase = 'interact';
      const { InteractionEngine } = await import('../agent/interaction-engine.js');
      const interactionEngine = new InteractionEngine(
        session,
        config.timeouts
      );
      
      try {
        await interactionEngine.detectAndInteract();
      } catch (error) {
        console.warn('Auto-detection interaction failed:', error);
      }
      
      await interactionEngine.executeActions(config.actions);
      await evidenceCapture.captureActionScreenshots(session, config.actions);
      await evidenceCapture.captureScreenshot(session, 'final-state');
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Phase 6: Capture console logs
      await evidenceCapture.captureConsoleLogs(session);
      await evidenceCapture.saveConsoleLogs(gameUrl);
      
      // Phase 7: AI Analysis
      this.currentPhase = 'analyze';
      const screenshots = evidenceCapture.getScreenshots();
      const consoleErrors = evidenceCapture.getConsoleErrors();
      const consoleWarnings = evidenceCapture.getConsoleWarnings();
      const executionTimeSeconds = (Date.now() - this.currentTest.startTime) / 1000;
      
      const report = await evaluator.evaluate(
        gameUrl,
        screenshots,
        consoleErrors,
        consoleWarnings,
        executionTimeSeconds
      );
      
      // Phase 8: Generate report
      this.currentPhase = 'report';
      const reportPath = join(this.outputDir, `report-${Date.now()}.json`);
      await writeFile(reportPath, JSON.stringify(report, null, 2));
      
      // Close browser
      await session.close();
      
      // Complete
      this.currentPhase = 'complete';
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error) {
      console.error('Test failed:', error);
      this.currentPhase = 'error';
      // Keep error state for a bit so frontend can detect it
      await new Promise(resolve => setTimeout(resolve, 1000));
      throw error;
    } finally {
      this.testRunning = false;
      // Keep phase state for a moment before resetting to idle
      setTimeout(() => {
        this.currentPhase = 'idle';
        this.currentTest = null;
      }, 2000);
    }
  }

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.app.listen(this.port, () => {
        console.log(`\n${'═'.repeat(60)}`);
        console.log(`📊 Dashboard running at:`);
        console.log(`   ${'→'.repeat(2)} http://localhost:${this.port}`);
        console.log(`${'═'.repeat(60)}\n`);
        resolve();
      });
    });
  }

  stop(): void {
    // Express doesn't have a built-in stop method
    // In production, you'd want to store the server instance
  }
}

