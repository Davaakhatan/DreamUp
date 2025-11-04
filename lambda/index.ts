/**
 * AWS Lambda handler for DreamUp QA Agent
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { QAAgent } from '../src/agent/qa-agent.js';
import { BrowserbaseProvider } from '../src/browser/browserbase-provider.js';
import { LocalPlaywrightProvider } from '../src/browser/local-provider.js';
import { EvidenceCapture } from '../src/agent/evidence-capture.js';
import { Evaluator } from '../src/agent/evaluator.js';
import { loadConfig } from '../src/config/config-loader.js';
import { parseInputSchema } from '../src/utils/input-schema-parser.js';
import type { InputSchema } from '../src/types/input-schema.js';

interface LambdaRequest {
  gameUrl: string;
  config?: string; // JSON string or config file path
  inputSchema?: InputSchema; // Input schema object
  outputDir?: string;
  useLocalBrowser?: boolean;
}

/**
 * Lambda handler for QA agent
 */
export async function handler(
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> {
  const startTime = Date.now();
  
  try {
    // Parse request body
    let request: LambdaRequest;
    if (typeof event.body === 'string') {
      request = JSON.parse(event.body);
    } else {
      request = event.body || {};
    }

    // Validate required fields
    if (!request.gameUrl) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          error: 'Missing required field: gameUrl',
        }),
      };
    }

    // Load configuration
    const config = await loadConfig(request.config);

    // Parse input schema if provided
    let parsedInputSchema = undefined;
    if (request.inputSchema) {
      parsedInputSchema = parseInputSchema(request.inputSchema);
    }

    // Initialize browser provider
    const useLocal = request.useLocalBrowser || process.env.USE_LOCAL_BROWSER === 'true';
    let browserProvider;
    if (useLocal) {
      browserProvider = new LocalPlaywrightProvider();
    } else {
      try {
        browserProvider = new BrowserbaseProvider();
      } catch (error) {
        console.warn('Browserbase not available, falling back to local browser');
        browserProvider = new LocalPlaywrightProvider();
      }
    }

    // Create browser session
    const session = await browserProvider.createSession();

    // Initialize components
    const outputDir = request.outputDir || '/tmp/qa-output';
    const evidenceCapture = new EvidenceCapture(outputDir);
    const evaluator = new Evaluator();

    // Create agent
    const agent = new QAAgent(
      session,
      config,
      evidenceCapture,
      evaluator,
      parsedInputSchema
    );

    // Run test
    const report = await agent.testGame(request.gameUrl);

    // Close browser session
    await session.close();

    // Calculate execution time
    const executionTime = Date.now() - startTime;

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        success: true,
        report,
        executionTimeMs: executionTime,
        lambdaContext: {
          requestId: context.requestId,
          remainingTimeMs: context.getRemainingTimeInMillis(),
        },
      }),
    };
  } catch (error) {
    const executionTime = Date.now() - startTime;
    
    console.error('Lambda execution error:', error);

    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
        executionTimeMs: executionTime,
        lambdaContext: {
          requestId: context.requestId,
          remainingTimeMs: context.getRemainingTimeInMillis(),
        },
      }),
    };
  }
}

