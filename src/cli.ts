#!/usr/bin/env node

/**
 * CLI interface for QA agent
 */

// Load .env file if it exists
import { readFileSync } from 'fs';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env file from project root
function loadEnvFile() {
  // Try multiple possible locations
  const possiblePaths = [
    join(__dirname, '..', '..', '.env'), // From dist/ to project root
    join(process.cwd(), '.env'), // Current working directory
    '.env', // Relative path
  ];

  for (const envPath of possiblePaths) {
    if (existsSync(envPath)) {
      try {
        const envContent = readFileSync(envPath, 'utf-8');
        envContent.split('\n').forEach((line) => {
          let trimmed = line.trim();
          // Handle 'export KEY=value' format by removing 'export' prefix
          if (trimmed.startsWith('export ')) {
            trimmed = trimmed.replace(/^export\s+/, '');
          }
          if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
            const [key, ...valueParts] = trimmed.split('=');
            const value = valueParts.join('=').trim();
            if (key && value && !process.env[key.trim()]) {
              // Only set if not already set (don't override existing env vars)
              process.env[key.trim()] = value.replace(/^["']|["']$/g, ''); // Remove quotes if present
            }
          }
        });
        return;
      } catch (error) {
        // Continue to next path
      }
    }
  }
}

loadEnvFile();

import { Command } from 'commander';
import { writeFile } from 'fs/promises';
import { BrowserbaseProvider } from './browser/browserbase-provider.js';
import { LocalPlaywrightProvider } from './browser/local-provider.js';
import { EvidenceCapture } from './agent/evidence-capture.js';
import { Evaluator } from './agent/evaluator.js';
import { QAAgent } from './agent/qa-agent.js';
import { loadConfig } from './config/config-loader.js';
import { CLIUI } from './utils/cli-ui.js';
import { DashboardServer } from './dashboard/server.js';
import { parseInputSchema } from './utils/input-schema-parser.js';
import type { InputSchema } from './types/input-schema.js';
import { readFile } from 'fs/promises';

const program = new Command();

program
  .name('qa-agent')
  .description('Autonomous AI agent for testing browser-based games')
  .version('1.0.0');

program
  .command('test')
  .description('Test a browser game at the given URL')
  .argument('<game-url>', 'URL of the game to test')
  .option('-c, --config <file>', 'Path to configuration JSON file')
  .option('-s, --input-schema <file>', 'Path to input schema JSON file (control layout)')
  .option('-o, --output <dir>', 'Output directory for reports and screenshots', './output')
  .action(async (gameUrl: string, options: { config?: string; inputSchema?: string; output?: string }) => {
    CLIUI.banner();
    
    const ui = new CLIUI();
    const outputDir = options.output || './output';

    try {
      // Load configuration
      ui.startSpinner('Loading configuration...');
      const config = await loadConfig(options.config);
      ui.succeedSpinner('Configuration loaded');

      // Initialize browser
      ui.startSpinner('Creating browser session...');
      
      // Use local browser if USE_LOCAL_BROWSER env var is set
      let browserProvider: any;
      const useLocal = process.env.USE_LOCAL_BROWSER === 'true';
      
      if (useLocal) {
        browserProvider = new LocalPlaywrightProvider();
      } else {
        try {
          browserProvider = new BrowserbaseProvider();
        } catch (error) {
          ui.succeedSpinner('Browserbase not available, using local browser...');
          browserProvider = new LocalPlaywrightProvider();
        }
      }
      
      const session = await browserProvider.createSession();
      ui.succeedSpinner('Browser session created');

      // Load input schema if provided
      let parsedInputSchema = undefined;
      if (options.inputSchema) {
        ui.startSpinner('Loading input schema...');
        try {
          const schemaContent = await readFile(options.inputSchema, 'utf-8');
          const inputSchema: InputSchema = JSON.parse(schemaContent);
          parsedInputSchema = parseInputSchema(inputSchema);
          ui.succeedSpinner(`Input schema loaded: ${parsedInputSchema.metadata.gameName || 'unnamed game'}`);
        } catch (error) {
          ui.failSpinner();
          CLIUI.warning(`Failed to load input schema: ${error instanceof Error ? error.message : String(error)}`);
          CLIUI.info('Continuing without input schema...');
        }
      }

      // Initialize components
      ui.startSpinner('Initializing components...');
      const evidenceCapture = new EvidenceCapture(outputDir);
      const evaluator = new Evaluator();
      ui.succeedSpinner('Components initialized');

      // Create agent
      const agent = new QAAgent(session, config, evidenceCapture, evaluator, parsedInputSchema);

      // Run test
      CLIUI.section('Running Test');
      CLIUI.info(`Game URL: ${gameUrl}`);
      CLIUI.info(`Output: ${outputDir}`);
      
      ui.startSpinner('Executing test sequence...');
      const report = await agent.testGame(gameUrl);
      ui.succeedSpinner('Test completed');

      // Save report
      const reportPath = join(outputDir, `report-${Date.now()}.json`);
      await writeFile(reportPath, JSON.stringify(report, null, 2));

      // Close browser
      ui.startSpinner('Cleaning up...');
      await session.close();
      ui.succeedSpinner('Browser session closed');

      // Display results
      CLIUI.reportSummary(report);
      
      if (report.issues.length > 0) {
        CLIUI.issues(report.issues);
      }

      CLIUI.info(`\n📄 Full report: ${reportPath}`);
      CLIUI.info(`📸 Screenshots: ${join(outputDir, 'screenshots')}`);

      // Exit with appropriate code
      process.exit(report.status === 'pass' ? 0 : 1);
    } catch (error) {
      ui.failSpinner();
      CLIUI.error(`Test execution failed: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  });

program
  .command('dashboard')
  .description('Start web dashboard for viewing test results')
  .option('-p, --port <port>', 'Port to run dashboard on', '3000')
  .option('-o, --output <dir>', 'Output directory containing reports', './output')
  .action(async (options: { port?: string; output?: string }) => {
    CLIUI.banner();
    
    const port = parseInt(options.port || '3000', 10);
    const outputDir = options.output || './output';

    CLIUI.section('Starting Dashboard');
    CLIUI.info(`Port: ${port}`);
    CLIUI.info(`Reports directory: ${outputDir}`);

    const server = new DashboardServer(port, outputDir);
    await server.start();

    // Keep process alive
    process.on('SIGINT', () => {
      CLIUI.info('\nShutting down dashboard...');
      process.exit(0);
    });
  });

program.parse();

