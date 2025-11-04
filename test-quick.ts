#!/usr/bin/env tsx
/**
 * Quick test script - tests a single game to verify functionality
 */

// Load .env file
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function loadEnvFile() {
  const possiblePaths = [join(__dirname, '.env'), join(process.cwd(), '.env'), '.env'];
  for (const envPath of possiblePaths) {
    if (existsSync(envPath)) {
      try {
        const envContent = readFileSync(envPath, 'utf-8');
        envContent.split('\n').forEach((line) => {
          let trimmed = line.trim();
          if (trimmed.startsWith('export ')) trimmed = trimmed.replace(/^export\s+/, '');
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
        // Continue
      }
    }
  }
}

loadEnvFile();

import { QAAgent } from './src/agent/qa-agent.js';
import { BrowserbaseProvider } from './src/browser/browserbase-provider.js';
import { LocalPlaywrightProvider } from './src/browser/local-provider.js';
import { EvidenceCapture } from './src/agent/evidence-capture.js';
import { Evaluator } from './src/agent/evaluator.js';
import { loadConfig } from './src/config/config-loader.js';

const TEST_URL = process.argv[2] || 'https://play2048.co/';

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║  DreamUp QA Pipeline - Quick Test                      ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');
  console.log(`Testing: ${TEST_URL}\n`);

  try {
    const config = await loadConfig();
    
    // Use local browser if USE_LOCAL_BROWSER env var is set, or if Browserbase fails
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
    const evidenceCapture = new EvidenceCapture('./output');
    const evaluator = new Evaluator();
    const agent = new QAAgent(session, config, evidenceCapture, evaluator);

    const startTime = Date.now();
    const report = await agent.testGame(TEST_URL);
    const duration = (Date.now() - startTime) / 1000;

    await session.close();

    console.log(`\n${'='.repeat(60)}`);
    console.log('Test Results');
    console.log(`${'='.repeat(60)}`);
    console.log(`Status: ${report.status}`);
    console.log(`Playability Score: ${report.playability_score}/100`);
    console.log(`Duration: ${duration.toFixed(2)}s`);
    console.log(`Screenshots: ${report.screenshots.length}`);
    console.log(`Issues: ${report.issues.length}`);
    
    if (report.issues.length > 0) {
      console.log('\nIssues:');
      report.issues.forEach((issue, i) => {
        console.log(`  ${i + 1}. [${issue.severity.toUpperCase()}] ${issue.description}`);
      });
    }
    
    console.log(`\n${'='.repeat(60)}\n`);

    process.exit(report.status === 'error' ? 1 : 0);
  } catch (error) {
    console.error('\n✗ Test failed:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main();

