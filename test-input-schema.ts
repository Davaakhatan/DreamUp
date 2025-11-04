#!/usr/bin/env tsx

/**
 * Test script for input schema functionality
 */

// Load .env file first
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
        // Continue to next path
      }
    }
  }
}

// Load environment variables
loadEnvFile();

import { readFile } from 'fs/promises';
import { BrowserbaseProvider } from './src/browser/browserbase-provider.js';
import { LocalPlaywrightProvider } from './src/browser/local-provider.js';
import { EvidenceCapture } from './src/agent/evidence-capture.js';
import { Evaluator } from './src/agent/evaluator.js';
import { QAAgent } from './src/agent/qa-agent.js';
import { loadConfig } from './src/config/config-loader.js';
import { parseInputSchema } from './src/utils/input-schema-parser.js';
import type { InputSchema } from './src/types/input-schema.js';

// Test game URL (2048 game)
const TEST_GAME_URL = 'https://play2048.co/';

// Example input schema for 2048 (uses arrow keys)
const exampleInputSchema: InputSchema = {
  gameId: '2048-test',
  gameName: '2048 Puzzle Game',
  axes2D: [
    {
      name: 'Move',
      description: '2D movement for tile sliding',
      smoothing: 0.2,
      bindings: [
        { type: 'key', input: 'ArrowUp' },
        { type: 'key', input: 'ArrowDown' },
        { type: 'key', input: 'ArrowLeft' },
        { type: 'key', input: 'ArrowRight' },
        { type: 'key', input: 'w' },
        { type: 'key', input: 's' },
        { type: 'key', input: 'a' },
        { type: 'key', input: 'd' }
      ]
    }
  ],
  notes: '2048 uses arrow keys or WASD to slide tiles. This schema ensures the agent uses the correct keys.'
};

async function testInputSchema() {
  console.log('🧪 Testing Input Schema Functionality\n');
  console.log('=' .repeat(60));
  
  try {
    // Parse input schema
    console.log('\n1. Parsing Input Schema...');
    const parsedSchema = parseInputSchema(exampleInputSchema);
    console.log('✅ Input schema parsed successfully');
    console.log(`   Game: ${parsedSchema.metadata.gameName}`);
    console.log(`   All keys: ${parsedSchema.allKeys.join(', ')}`);
    console.log(`   Axes found: ${parsedSchema.axisToKeys.size}`);
    
    // Show axis mappings
    console.log('\n2. Axis Mappings:');
    for (const [axisName, keys] of parsedSchema.axisToKeys.entries()) {
      console.log(`   ${axisName}:`);
      if (keys.negative) console.log(`     Negative: ${keys.negative.join(', ')}`);
      if (keys.positive) console.log(`     Positive: ${keys.positive.join(', ')}`);
    }
    
    // Load config
    console.log('\n3. Loading Configuration...');
    const config = await loadConfig();
    console.log('✅ Configuration loaded');
    
    // Initialize browser (use local for testing, fallback to local if Browserbase fails)
    console.log('\n4. Creating Browser Session...');
    const useLocal = process.env.USE_LOCAL_BROWSER === 'true' || !process.env.BROWSERBASE_API_KEY;
    let browserProvider;
    let session;
    
    if (useLocal) {
      console.log('   Using local Playwright browser');
      browserProvider = new LocalPlaywrightProvider();
      session = await browserProvider.createSession({ headless: false });
    } else {
      try {
        console.log('   Attempting Browserbase...');
        browserProvider = new BrowserbaseProvider();
        session = await browserProvider.createSession({ headless: false });
      } catch (error) {
        console.log('   Browserbase failed, falling back to local Playwright browser');
        browserProvider = new LocalPlaywrightProvider();
        session = await browserProvider.createSession({ headless: false });
      }
    }
    console.log('✅ Browser session created');
    
    // Initialize components
    console.log('\n5. Initializing Components...');
    const evidenceCapture = new EvidenceCapture('./output');
    const evaluator = new Evaluator();
    console.log('✅ Components initialized');
    
    // Create agent WITH input schema
    console.log('\n6. Creating QA Agent with Input Schema...');
    const agent = new QAAgent(session, config, evidenceCapture, evaluator, parsedSchema);
    console.log('✅ Agent created with input schema');
    
    // Run test
    console.log('\n7. Running Test with Input Schema...');
    console.log(`   Game URL: ${TEST_GAME_URL}`);
    console.log('   The agent will use keys from the input schema instead of defaults.\n');
    
    const report = await agent.testGame(TEST_GAME_URL);
    
    // Close browser
    await session.close();
    
    // Display results
    console.log('\n' + '='.repeat(60));
    console.log('📊 Test Results');
    console.log('='.repeat(60));
    console.log(`Status: ${report.status}`);
    console.log(`Playability Score: ${report.playability_score}/100`);
    console.log(`Issues: ${report.issues.length}`);
    console.log(`Screenshots: ${report.screenshots.length}`);
    console.log(`Execution Time: ${report.execution_time_seconds.toFixed(2)}s`);
    
    if (report.issues.length > 0) {
      console.log('\n⚠️  Issues Found:');
      report.issues.forEach((issue, i) => {
        console.log(`   ${i + 1}. [${issue.severity}] ${issue.description}`);
      });
    }
    
    console.log('\n✅ Input schema test completed!');
    console.log('\nCheck the console output above for messages like:');
    console.log('   "🎮 Using input schema: ArrowRight -> ArrowRight (right)"');
    console.log('   This confirms the agent is using the input schema.');
    
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    if (error instanceof Error) {
      console.error('   Error message:', error.message);
      console.error('   Stack:', error.stack);
    }
    process.exit(1);
  }
}

// Run test
testInputSchema();

