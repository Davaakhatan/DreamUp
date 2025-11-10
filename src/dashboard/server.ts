/**
 * Web dashboard server for viewing test results
 */

import express from 'express';
import { readFile, readdir, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { BrowserbaseProvider } from '../browser/browserbase-provider.js';
import { LocalPlaywrightProvider } from '../browser/local-provider.js';
import { EvidenceCapture } from '../agent/evidence-capture.js';
import { Evaluator } from '../agent/evaluator.js';
import { QAAgent } from '../agent/qa-agent.js';
import { loadConfig } from '../config/config-loader.js';
import type { QAReport } from '../types/report.js';

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
      
      // Enable CORS for all origins (development and production)
      // Allow specific origins or use * for all (less secure but works for all frontends)
      const origin = req.headers.origin;
      const allowedOrigins = [
        'https://qa-dream-up.vercel.app',
        'https://qapipeline-7c83d.web.app',
        'http://localhost:3000',
        'http://localhost:5173',
      ];
      
      if (origin && allowedOrigins.includes(origin)) {
        res.header('Access-Control-Allow-Origin', origin);
      } else {
        // Fallback to * for any other origin (less secure but flexible)
        res.header('Access-Control-Allow-Origin', '*');
      }
      
      res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.header('Access-Control-Allow-Credentials', 'true');
      
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

    // API: Get all reports (from file system)
    this.app.get('/api/reports', async (req, res) => {
      try {
        // Read reports from file system
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

      // Check if test is already running (with timeout check)
      if (this.testRunning) {
        const stuckTime = this.currentTest ? Date.now() - this.currentTest.startTime : 0;
        if (stuckTime > 300000) { // 5 minutes - test is stuck
          console.warn('⚠ Resetting stuck test before starting new one...');
          await this.forceResetTestState();
          await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for reset
        } else {
          return res.status(409).json({ 
            error: 'A test is already running',
            currentTest: this.currentTest?.gameUrl,
            elapsedTime: stuckTime / 1000
          });
        }
      }
      
      try {
        // Validate environment variables before starting
        if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY.includes('your_openai_api_key')) {
          return res.status(500).json({ 
            error: 'Invalid OPENAI_API_KEY',
            message: 'OPENAI_API_KEY is missing or contains placeholder text. Please set a valid OpenAI API key in Railway environment variables.'
          });
        }

        // Get showBrowser option from request
        const showBrowser = (req.body as any).showBrowser === true;
        
        // Run test asynchronously (don't await - let it run in background)
        this.runTestAsync(gameUrl, showBrowser).catch(error => {
          console.error('Test execution error:', error);
          // Error already handled in runTestAsync's catch block
        });

        // Return immediately with success
        res.json({ 
          status: 'started', 
          message: 'Test started successfully',
          gameUrl 
        });
      } catch (error) {
        console.error('Error starting test:', error);
        res.status(500).json({ 
          error: 'Failed to start test',
          message: error instanceof Error ? error.message : String(error)
        });
      }
    });

    // API: Get test status (for polling)
    this.app.get('/api/test/status', (req, res) => {
      const elapsedTime = this.currentTest ? Date.now() - this.currentTest.startTime : 0;
      
      // Auto-reset if test has been running for more than 5 minutes (likely stuck)
      if (this.testRunning && elapsedTime > 300000) {
        console.warn('⚠ Test appears stuck (5+ minutes), auto-resetting...');
        this.forceResetTestState();
      }
      
      res.json({ 
        running: this.testRunning,
        currentTest: this.currentTest,
        phase: this.currentPhase,
        elapsedTime: elapsedTime / 1000, // seconds
        // Include error info if phase is error
        error: this.currentPhase === 'error' ? 'Test execution failed' : undefined
      });
    });
    
    // POST /api/test/reset - Manually reset test state (for stuck tests)
    this.app.post('/api/test/reset', async (req, res) => {
      console.log('🔄 Manual test reset requested');
      await this.forceResetTestState();
      res.json({ success: true, message: 'Test state reset' });
    });
  }

  private testRunning = false;
  private currentTest: { gameUrl: string; startTime: number } | null = null;
  private currentPhase: string = 'idle'; // 'idle' | 'load' | 'capture' | 'interact' | 'analyze' | 'report' | 'complete'
  private currentSession: any = null; // Track current browser session

  private async runTestAsync(gameUrl: string, showBrowser: boolean = false): Promise<void> {
    // Check if test is running, but if it's been stuck for more than 5 minutes, reset it
    if (this.testRunning) {
      const stuckTime = this.currentTest ? Date.now() - this.currentTest.startTime : 0;
      if (stuckTime > 300000) { // 5 minutes
        console.warn('⚠ Previous test appears stuck, resetting state...');
        await this.forceResetTestState();
      } else {
        throw new Error('A test is already running');
      }
    }

    // Ensure any previous session is closed
    if (this.currentSession) {
      try {
        console.log('Closing previous session...');
        await Promise.race([
          this.currentSession.close(),
          new Promise(resolve => setTimeout(resolve, 5000)) // Timeout after 5s
        ]);
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for session to fully close
      } catch (error) {
        console.warn('Error closing previous session:', error);
      }
      this.currentSession = null;
    }

    this.testRunning = true;
    this.currentTest = { gameUrl, startTime: Date.now() };
    this.currentPhase = 'load';

    // Add overall timeout wrapper to prevent tests from hanging forever
    const maxTestTime = 300000; // 5 minutes max
    const testTimeout = setTimeout(() => {
      if (this.testRunning) {
        console.error('⚠ Test exceeded maximum time limit (5 minutes), forcing reset...');
        this.forceResetTestState();
      }
    }, maxTestTime);

    try {
      // Phase 1: Load configuration
      const config = await loadConfig();
      
      // Phase 2: Initialize browser
      this.currentPhase = 'load';
      
      // Try Browserbase first, fallback to local Playwright if quota limit reached
      let browserProvider: any;
      let session;
      let useLocalBrowser = false;
      
      // Check if user wants to use local browser (via env var) or if Browserbase fails
      const useLocal = process.env.USE_LOCAL_BROWSER === 'true';
      const shouldShowBrowser = process.env.SHOW_BROWSER === 'true' || showBrowser;
      
      if (useLocal) {
        console.log('📱 Using local browser (Playwright - FREE)');
        if (shouldShowBrowser) {
          console.log('👁️  Browser window will be VISIBLE');
          process.env.SHOW_BROWSER = 'true';
        }
        browserProvider = new LocalPlaywrightProvider();
        useLocalBrowser = true;
      } else {
        try {
          browserProvider = new BrowserbaseProvider();
        } catch (browserbaseError) {
          console.warn('Browserbase not available, falling back to local browser...');
          if (shouldShowBrowser) {
            process.env.SHOW_BROWSER = 'true';
          }
          browserProvider = new LocalPlaywrightProvider();
          useLocalBrowser = true;
        }
      }
      
      try {
        session = await browserProvider.createSession({ headless: !shouldShowBrowser || !useLocalBrowser });
        this.currentSession = session; // Track session for cleanup
      } catch (error) {
        // If Browserbase quota limit reached, automatically switch to local browser
        if (error instanceof Error && (error.message.includes('402') || error.message.includes('quota') || error.message.includes('Payment Required'))) {
          console.warn('⚠️  Browserbase quota limit reached. Automatically switching to local browser (FREE)...');
          if (shouldShowBrowser) {
            process.env.SHOW_BROWSER = 'true';
            console.log('👁️  Browser window will be VISIBLE');
          }
          browserProvider = new LocalPlaywrightProvider();
          useLocalBrowser = true;
          try {
            session = await browserProvider.createSession({ headless: !shouldShowBrowser });
            this.currentSession = session;
          } catch (localError) {
            throw new Error(
              `Failed to start local browser: ${localError instanceof Error ? localError.message : String(localError)}\n\n` +
              `Install Playwright browsers: npx playwright install chromium`
            );
          }
        } else if (error instanceof Error && error.message.includes('429')) {
          // 429 - too many concurrent sessions
          console.warn('Browserbase session limit reached. Waiting 5 seconds and retrying...');
          await new Promise(resolve => setTimeout(resolve, 5000));
          try {
            session = await browserProvider.createSession();
            this.currentSession = session;
          } catch (retryError) {
            // If retry also fails, try local browser
            console.warn('Browserbase retry failed, switching to local browser...');
            browserProvider = new LocalPlaywrightProvider();
            useLocalBrowser = true;
            session = await browserProvider.createSession();
            this.currentSession = session;
          }
        } else {
          throw error;
        }
      }
      
      // Initialize components
      const evidenceCapture = new EvidenceCapture(this.outputDir);
      
      // Validate OpenAI API key before creating evaluator
      if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY.includes('your_openai_api_key')) {
        throw new Error(
          'OPENAI_API_KEY is missing or invalid. ' +
          'Please set a valid OpenAI API key in Railway environment variables. ' +
          'Get your key at: https://platform.openai.com/api-keys'
        );
      }
      
      const evaluator = new Evaluator();
      
      // Create agent
      const agent = new QAAgent(session, config, evidenceCapture, evaluator);
      
      // Phase 3: Load game
      this.currentPhase = 'load';
      await session.navigate(gameUrl);
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Phase 4: Capture evidence
      this.currentPhase = 'capture';
      console.log('📸 Initializing evidence capture...');
      await evidenceCapture.initialize();
      console.log('📸 Capturing initial screenshot...');
      try {
        await Promise.race([
          evidenceCapture.captureScreenshot(session, 'initial-load'),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Screenshot timeout')), 10000))
        ]);
        console.log('✓ Initial screenshot captured');
      } catch (error) {
        console.warn('⚠ Initial screenshot failed, continuing:', error);
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Phase 5: Interact
      this.currentPhase = 'interact';
      const { InteractionEngine } = await import('../agent/interaction-engine.js');
      const interactionEngine = new InteractionEngine(
        session,
        config.timeouts,
        evidenceCapture // Pass evidence capture for screenshots during interactions
      );
      
      try {
        console.log('🔍 Detecting and interacting with game...');
        await Promise.race([
          interactionEngine.detectAndInteract(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Detect timeout')), 30000))
        ]);
        await session.wait(500);
        console.log('📸 Capturing screenshot after auto-interact...');
        try {
          await Promise.race([
            evidenceCapture.captureScreenshot(session, 'after-auto-interact'),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Screenshot timeout')), 10000))
          ]);
        } catch (screenshotError) {
          console.warn('⚠ Screenshot after auto-interact failed, continuing:', screenshotError);
        }
      } catch (error) {
        console.warn('Auto-detection interaction failed:', error);
      }
      
      // Execute actions - screenshots will be captured automatically during execution
      console.log('🎮 Executing game actions...');
      try {
        await Promise.race([
          interactionEngine.executeActions(config.actions),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Actions timeout')), 180000)) // 3 min max (increased)
        ]);
        console.log('✓ All actions executed successfully');
      } catch (actionsError) {
        if (actionsError instanceof Error && actionsError.message.includes('timeout')) {
          console.warn('⚠ Actions execution timed out after 3 minutes (this is normal for longer games)');
        } else {
          console.warn('⚠ Actions execution failed:', actionsError);
        }
        // Continue to final screenshot even if actions timed out
      }
      
      // Final state screenshot
      console.log('📸 Capturing final state screenshot...');
      await session.wait(1000);
      try {
        // Check if browser is still open before final screenshot
        try {
          await session.evaluate('document.body');
        } catch (e) {
          console.warn('⚠ Browser closed, skipping final screenshot');
        }
        
        await Promise.race([
          evidenceCapture.captureScreenshot(session, 'final-state'),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Screenshot timeout')), 15000)) // Increased timeout
        ]);
        console.log('✓ Final screenshot captured');
      } catch (screenshotError) {
        console.warn('⚠ Final screenshot failed, continuing:', screenshotError);
        // Continue even if screenshot fails - report can still be generated
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Phase 6: Capture console logs
      console.log('📋 Capturing console logs...');
      try {
        await Promise.race([
          evidenceCapture.captureConsoleLogs(session),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Console logs timeout')), 5000))
        ]);
        await Promise.race([
          evidenceCapture.saveConsoleLogs(gameUrl),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Save logs timeout')), 5000))
        ]);
      } catch (logError) {
        console.warn('⚠ Console log capture failed, continuing:', logError);
      }
      
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
      if (session) {
        try {
          await session.close();
        } catch (error) {
          console.warn('Error closing session:', error);
        }
      }
      this.currentSession = null;
      
      // Complete
      this.currentPhase = 'complete';
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error) {
      console.error('Test failed:', error);
      this.currentPhase = 'error';
      
      // Ensure session is closed even on error
      if (this.currentSession) {
        try {
          await this.currentSession.close();
        } catch (closeError) {
          console.warn('Error closing session on error:', closeError);
        }
        this.currentSession = null;
      }
      
      // Keep error state for a bit so frontend can detect it
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Generate error report
      let errorReport: QAReport;
      try {
        const executionTime = (Date.now() - (this.currentTest?.startTime || Date.now())) / 1000;
        errorReport = {
          status: 'error',
          playability_score: 0,
          issues: [
            {
              severity: 'critical',
              description: error instanceof Error ? error.message : String(error),
              confidence: 1.0
            }
          ],
          screenshots: [],
          timestamp: new Date().toISOString(),
          game_url: gameUrl,
          execution_time_seconds: executionTime,
          metadata: {
            load_time_ms: executionTime * 1000
          }
        };
        
        // Save error report
        const reportPath = join(this.outputDir, `report-${Date.now()}.json`);
        await writeFile(reportPath, JSON.stringify(errorReport, null, 2));
        
      } catch (reportError) {
        console.warn('Failed to save error report:', reportError);
      }
      
      // Don't throw - error already logged
    } finally {
      // Clear timeout
      clearTimeout(testTimeout);
      
      // Always reset test state - even if something fails
      await this.forceResetTestState();
    }
  }
  
  /**
   * Force reset test state - used for cleanup and stuck test recovery
   */
  private async forceResetTestState(): Promise<void> {
    try {
      // Close session if still open (with timeout)
      if (this.currentSession) {
        try {
          await Promise.race([
            this.currentSession.close(),
            new Promise(resolve => setTimeout(resolve, 5000)) // 5s timeout
          ]);
        } catch (error) {
          console.warn('Error closing session during reset:', error);
        }
        this.currentSession = null;
      }
    } catch (error) {
      console.warn('Error in forceResetTestState:', error);
    } finally {
      // Always reset flags
      this.testRunning = false;
      this.currentTest = null;
      
      // Reset phase after a delay (to allow frontend to poll)
      setTimeout(() => {
        this.currentPhase = 'idle';
      }, 2000);
    }
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Bind to 0.0.0.0 for Railway/Cloud Run (not just localhost)
      const host = process.env.HOST || '0.0.0.0';
      
      console.log(`\n${'═'.repeat(60)}`);
      console.log(`📊 Starting Dashboard Server...`);
      console.log(`   Host: ${host}`);
      console.log(`   Port: ${this.port}`);
      console.log(`   Output Dir: ${this.outputDir}`);
      console.log(`${'═'.repeat(60)}\n`);
      
      try {
        this.app.listen(this.port, host, () => {
          console.log(`\n${'═'.repeat(60)}`);
          console.log(`✅ Dashboard Server Started Successfully!`);
          console.log(`   ${'→'.repeat(2)} http://${host}:${this.port}`);
          console.log(`   ${'→'.repeat(2)} http://localhost:${this.port}`);
          console.log(`${'═'.repeat(60)}\n`);
          resolve();
        }).on('error', (error: NodeJS.ErrnoException) => {
          console.error(`\n${'═'.repeat(60)}`);
          console.error(`❌ Failed to start server on ${host}:${this.port}`);
          console.error(`   Error: ${error.message}`);
          if (error.code === 'EADDRINUSE') {
            console.error(`   Port ${this.port} is already in use`);
          }
          console.error(`${'═'.repeat(60)}\n`);
          reject(error);
        });
      } catch (error) {
        console.error('❌ Exception during server startup:', error);
        reject(error);
      }
    });
  }

  stop(): void {
    // Express doesn't have a built-in stop method
    // In production, you'd want to store the server instance
  }
}

