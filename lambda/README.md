# Lambda Deployment Guide

This directory contains the AWS Lambda configuration and deployment files for the DreamUp QA Agent.

## Prerequisites

1. AWS CLI configured with appropriate credentials
2. Node.js 20+ installed
3. Serverless Framework installed: `npm install -g serverless`
4. Required environment variables:
   - `OPENAI_API_KEY`
   - `BROWSERBASE_API_KEY` (optional, falls back to local browser)
   - `BROWSERBASE_PROJECT_ID` (optional)
   - `USE_LOCAL_BROWSER` (optional, set to 'true' for local Playwright)

## Deployment

### Option 1: Using Serverless Framework (Recommended)

```bash
cd lambda
npm install
serverless deploy
```

### Option 2: Manual Package

```bash
cd lambda
npm install
npm run build
npm run package
# Upload qa-agent-lambda.zip to AWS Lambda
```

## Configuration

### Environment Variables

Set these in your Lambda function configuration or via `serverless.yml`:

- `OPENAI_API_KEY`: Required for AI evaluation
- `BROWSERBASE_API_KEY`: Optional, for Browserbase browser automation
- `BROWSERBASE_PROJECT_ID`: Optional, Browserbase project ID
- `USE_LOCAL_BROWSER`: Set to `'true'` to use local Playwright (requires Chromium in Lambda)

### Lambda Settings

- **Runtime**: Node.js 20.x
- **Timeout**: 300 seconds (5 minutes)
- **Memory**: 1024 MB (recommended for browser automation)

## API Usage

### Request Format

```json
{
  "gameUrl": "https://example.com/game.html",
  "config": "optional-config-json-string",
  "inputSchema": {
    "actions": [...],
    "axes1D": [...],
    "axes2D": [...]
  },
  "outputDir": "/tmp/qa-output",
  "useLocalBrowser": false
}
```

### Response Format

```json
{
  "success": true,
  "report": {
    "status": "pass",
    "playability_score": 85,
    "issues": [...],
    "screenshots": [...],
    "timestamp": "..."
  },
  "executionTimeMs": 45000,
  "lambdaContext": {
    "requestId": "...",
    "remainingTimeMs": 255000
  }
}
```

## Local Testing

Test the Lambda handler locally:

```bash
cd lambda
npm install
npm run build
node -e "
const { handler } = require('./dist/index.js');
handler({
  body: JSON.stringify({
    gameUrl: 'https://example.com/game.html'
  })
}, {
  requestId: 'test-request',
  getRemainingTimeInMillis: () => 300000
}).then(console.log);
"
```

## Notes

- Lambda has a 300-second (5 minute) timeout limit
- Browser automation requires sufficient memory (1024 MB recommended)
- Local Playwright requires Chromium to be included in the Lambda package (use AWS Lambda Layers)
- Screenshots are saved to `/tmp` (Lambda's ephemeral storage)

