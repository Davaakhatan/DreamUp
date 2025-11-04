#!/usr/bin/env tsx
/**
 * Automated test script for DreamUp QA Pipeline
 * Tests the system with multiple games to verify functionality
 */

// Load .env file if it exists
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env file from project root
function loadEnvFile() {
  const possiblePaths = [
    join(__dirname, '.env'),
    join(process.cwd(), '.env'),
    '.env',
  ];

  for (const envPath of possiblePaths) {
    if (existsSync(envPath)) {
      try {
        const envContent = readFileSync(envPath, 'utf-8');
        envContent.split('\n').forEach((line) => {
          let trimmed = line.trim();
          if (trimmed.startsWith('export ')) {
            trimmed = trimmed.replace(/^export\s+/, '');
          }
          if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
            const [key, ...valueParts] = trimmed.split('=');
            const value = valueParts.join('=').trim();
            if (key && value && !process.env[key.trim()]) {
              process.env[key.trim()] = value.replace(/^["']|["']$/g, '');
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

// Load environment variables
loadEnvFile();

import { QAAgent } from './src/agent/qa-agent.js';
import { BrowserbaseProvider } from './src/browser/browserbase-provider.js';
import { LocalPlaywrightProvider } from './src/browser/local-provider.js';
import { EvidenceCapture } from './src/agent/evidence-capture.js';
import { Evaluator } from './src/agent/evaluator.js';
import { loadConfig } from './src/config/config-loader.js';
import { readFile, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

// Test games to run
const TEST_GAMES = [
  {
    name: '2048',
    url: 'https://play2048.co/',
    expectedInteraction: 'arrow keys',
  },
  {
    name: 'Snake Game',
    url: 'https://playsnake.org/',
    expectedInteraction: 'arrow keys',
  },
  {
    name: 'Tetris',
    url: 'https://tetris.com/play-tetris',
    expectedInteraction: 'keyboard',
  },
];

interface TestResult {
  gameName: string;
  gameUrl: string;
  success: boolean;
  duration: number;
  screenshots: number;
  playabilityScore: number;
  issues: number;
  error?: string;
}

async function runTest(game: { name: string; url: string; expectedInteraction: string }): Promise<TestResult> {
  const startTime = Date.now();
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Testing: ${game.name}`);
  console.log(`URL: ${game.url}`);
  console.log(`${'='.repeat(60)}\n`);

  try {
    // Load configuration
    const config = await loadConfig();

    // Initialize browser - use local browser if USE_LOCAL_BROWSER env var is set, or if Browserbase fails
    let browserProvider: any;
    const useLocal = process.env.USE_LOCAL_BROWSER === 'true';
    
    if (useLocal) {
      console.log('📱 Using local browser (Playwright - FREE)\n');
      browserProvider = new LocalPlaywrightProvider();
    } else {
      try {
        browserProvider = new BrowserbaseProvider();
      } catch (error) {
        console.log('⚠️  Browserbase not available, using local browser (FREE)...\n');
        browserProvider = new LocalPlaywrightProvider();
      }
    }
    
    let session;
    try {
      session = await browserProvider.createSession();
    } catch (error) {
      // If Browserbase quota limit reached, automatically switch to local browser
      if (error instanceof Error && (error.message.includes('402') || error.message.includes('quota') || error.message.includes('Payment Required'))) {
        console.log('⚠️  Browserbase quota limit reached. Automatically switching to local browser (FREE)...\n');
        browserProvider = new LocalPlaywrightProvider();
        session = await browserProvider.createSession();
      } else {
        throw error;
      }
    }

    // Initialize components
    const evidenceCapture = new EvidenceCapture('./output');
    const evaluator = new Evaluator();

    // Create agent
    const agent = new QAAgent(session, config, evidenceCapture, evaluator);

    // Run test
    const report = await agent.testGame(game.url);

    // Close session
    await session.close();

    const duration = (Date.now() - startTime) / 1000;

    console.log(`\n✓ Test completed for ${game.name}`);
    console.log(`  Duration: ${duration.toFixed(2)}s`);
    console.log(`  Status: ${report.status}`);
    console.log(`  Playability Score: ${report.playability_score}/100`);
    console.log(`  Screenshots: ${report.screenshots.length}`);
    console.log(`  Issues: ${report.issues.length}`);

    return {
      gameName: game.name,
      gameUrl: game.url,
      success: report.status !== 'error',
      duration,
      screenshots: report.screenshots.length,
      playabilityScore: report.playability_score,
      issues: report.issues.length,
    };
  } catch (error) {
    const duration = (Date.now() - startTime) / 1000;
    const errorMessage = error instanceof Error ? error.message : String(error);

    console.error(`\n✗ Test failed for ${game.name}`);
    console.error(`  Error: ${errorMessage}`);
    console.error(`  Duration: ${duration.toFixed(2)}s`);

    return {
      gameName: game.name,
      gameUrl: game.url,
      success: false,
      duration,
      screenshots: 0,
      playabilityScore: 0,
      issues: 0,
      error: errorMessage,
    };
  }
}

async function verifyOutput(): Promise<void> {
  console.log(`\n${'='.repeat(60)}`);
  console.log('Verifying Output Files');
  console.log(`${'='.repeat(60)}\n`);

  const outputDir = './output';
  const screenshotsDir = join(outputDir, 'screenshots');

  // Check output directory
  if (!existsSync(outputDir)) {
    console.error('✗ Output directory does not exist');
    return;
  }
  console.log('✓ Output directory exists');

  // Check screenshots directory
  if (!existsSync(screenshotsDir)) {
    console.error('✗ Screenshots directory does not exist');
    return;
  }
  console.log('✓ Screenshots directory exists');

  // Count reports
  try {
    const files = await readdir(outputDir);
    const reports = files.filter(f => f.startsWith('report-') && f.endsWith('.json'));
    console.log(`✓ Found ${reports.length} report(s)`);
  } catch (error) {
    console.error('✗ Could not read output directory:', error);
  }

  // Count screenshots
  try {
    const screenshots = await readdir(screenshotsDir);
    const screenshotFiles = screenshots.filter(f => f.startsWith('screenshot-'));
    console.log(`✓ Found ${screenshotFiles.length} screenshot(s)`);
  } catch (error) {
    console.error('✗ Could not read screenshots directory:', error);
  }
}

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║  DreamUp QA Pipeline - Automated Test Suite           ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  const results: TestResult[] = [];

  // Run tests for each game
  for (const game of TEST_GAMES) {
    const result = await runTest(game);
    results.push(result);

    // Wait a bit between tests to avoid rate limiting
    if (game !== TEST_GAMES[TEST_GAMES.length - 1]) {
      console.log('\n⏳ Waiting 5 seconds before next test...\n');
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }

  // Print summary
  console.log(`\n${'='.repeat(60)}`);
  console.log('Test Summary');
  console.log(`${'='.repeat(60)}\n`);

  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);
  const totalScreenshots = results.reduce((sum, r) => sum + r.screenshots, 0);
  const avgScore = results.length > 0
    ? results.reduce((sum, r) => sum + r.playabilityScore, 0) / results.length
    : 0;

  console.log(`Total Tests: ${results.length}`);
  console.log(`Successful: ${successful} (${((successful / results.length) * 100).toFixed(1)}%)`);
  console.log(`Failed: ${failed}`);
  console.log(`Total Duration: ${totalDuration.toFixed(2)}s`);
  console.log(`Average Duration: ${(totalDuration / results.length).toFixed(2)}s`);
  console.log(`Total Screenshots: ${totalScreenshots}`);
  console.log(`Average Screenshots: ${(totalScreenshots / results.length).toFixed(1)}`);
  console.log(`Average Playability Score: ${avgScore.toFixed(1)}/100\n`);

  console.log('Detailed Results:');
  console.log('─'.repeat(60));
  for (const result of results) {
    const status = result.success ? '✓' : '✗';
    console.log(`${status} ${result.gameName.padEnd(20)} | Score: ${result.playabilityScore.toString().padStart(3)}/100 | Screenshots: ${result.screenshots.toString().padStart(2)} | Duration: ${result.duration.toFixed(1)}s`);
    if (result.error) {
      console.log(`  Error: ${result.error}`);
    }
  }

  // Verify output files
  await verifyOutput();

  // Exit with appropriate code
  const exitCode = failed > 0 ? 1 : 0;
  console.log(`\n${'='.repeat(60)}`);
  if (exitCode === 0) {
    console.log('✓ All tests passed!');
  } else {
    console.log(`✗ ${failed} test(s) failed`);
  }
  console.log(`${'='.repeat(60)}\n`);

  process.exit(exitCode);
}

// Run tests
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

