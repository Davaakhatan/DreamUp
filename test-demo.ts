#!/usr/bin/env tsx
/**
 * Demo test script - runs with visible browser so you can see it working
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

// Force local browser and show browser window
process.env.USE_LOCAL_BROWSER = 'true';
process.env.SHOW_BROWSER = 'true';

import { QAAgent } from './src/agent/qa-agent.js';
import { LocalPlaywrightProvider } from './src/browser/local-provider.js';
import { EvidenceCapture } from './src/agent/evidence-capture.js';
import { Evaluator } from './src/agent/evaluator.js';
import { loadConfig } from './src/config/config-loader.js';

const TEST_URL = process.argv[2] || 'https://play2048.co/';

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║  DreamUp QA Pipeline - DEMO (Visible Browser)         ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');
  console.log(`📱 Using LOCAL browser (FREE - no API key needed)`);
  console.log(`👁️  Browser window will be VISIBLE so you can watch!\n`);
  console.log(`Testing: ${TEST_URL}\n`);
  console.log('Watch the browser window to see the automation in action!\n');

  try {
    const config = await loadConfig();
    
    // Use local browser with visible window
    const browserProvider = new LocalPlaywrightProvider();
    const session = await browserProvider.createSession({ headless: false });
    
    const evidenceCapture = new EvidenceCapture('./output');
    const evaluator = new Evaluator();
    const agent = new QAAgent(session, config, evidenceCapture, evaluator);

    const startTime = Date.now();
    console.log('🚀 Starting test... Watch the browser window!\n');
    
    const report = await agent.testGame(TEST_URL);
    const duration = (Date.now() - startTime) / 1000;

    await session.close();

    console.log(`\n${'='.repeat(60)}`);
    console.log('✅ Test Results');
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
    console.log('✅ Test completed! Check ./output/ for screenshots and reports.\n');

    process.exit(report.status === 'error' ? 1 : 0);
  } catch (error) {
    console.error('\n✗ Test failed:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main();

