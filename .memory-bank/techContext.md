# Technical Context: DreamUp Browser Game QA Pipeline

## Technology Stack

### Current Implementation
- **Language**: TypeScript 5.3.2
- **Runtime**: Node.js 18+ (also supports Bun via `tsx`)
- **Browser Automation**: 
  - Primary: Browserbase SDK with CDP (Chrome DevTools Protocol) via Playwright
  - Fallback: Local Playwright (free, visible browser option)
- **AI Framework**: OpenAI SDK (direct usage)
- **Web Framework**: Express.js
- **UI**: Vanilla HTML/CSS/JS (no frameworks)
- **CLI**: Commander.js
- **Build Tool**: TypeScript compiler (tsc)
- **Test Runner**: Jest
- **Package Manager**: npm

### Required vs Implemented

| Requirement | Required | Implemented | Status |
|------------|----------|-------------|--------|
| Browserbase | ✅ Yes | ✅ Browserbase SDK | ✅ Complete |
| Stagehand | ✅ Recommended | ❌ Not implemented | ⚠️ Gap |
| Vercel AI SDK | ✅ Preferred | ❌ OpenAI SDK direct | ⚠️ Gap |
| TypeScript | ✅ Preferred | ✅ TypeScript 5.3.2 | ✅ Complete |
| Bun Support | ✅ Preferred (`bun run qa.ts`) | ✅ Supported (`npx tsx qa.ts`) | ✅ Complete |
| Lambda-Ready | ✅ Required | ✅ Modular TypeScript | ✅ Complete |

## Development Setup

### Prerequisites
- Node.js 18+ and npm
- Browserbase API key (optional - falls back to local browser)
- OpenAI API key (required for AI evaluation)

### Environment Variables
```bash
BROWSERBASE_API_KEY=your_key          # Optional
OPENAI_API_KEY=your_key               # Required
BROWSERBASE_PROJECT_ID=your_id        # Optional
USE_LOCAL_BROWSER=true                # Optional: use local Playwright
SHOW_BROWSER=true                     # Optional: show visible browser
```

### Build & Run
```bash
npm install
npm run build
npm run cli test <game-url>
npm run dashboard
```

## Technical Constraints

### Execution Limits
- Max execution time: 5 minutes per game
- Retry failed loads: up to 3 times
- Screenshots per test: 3-5
- Action timeout: 20 seconds
- Load timeout: 30 seconds

### Browser Limitations
- Headless mode by default (visible mode available via `SHOW_BROWSER`)
- Single-page browser sessions
- No mobile emulation
- No network interception

### AI Model Usage
- Primary: GPT-4o (Vision) for screenshot analysis
- Fallback: GPT-4 for text-only evaluation
- Cost: ~$0.01-0.05 per test (depends on screenshot count)

## Architecture Components

### Core Modules
```
src/
├── agent/
│   ├── qa-agent.ts          # Main orchestrator
│   ├── interaction-engine.ts # UI detection & interaction
│   ├── evidence-capture.ts   # Screenshots & logs
│   └── evaluator.ts          # AI evaluation
├── browser/
│   ├── browserbase-provider.ts  # Browserbase integration
│   └── local-provider.ts         # Local Playwright fallback
├── config/
│   ├── default-config.ts     # Default test configuration
│   └── config-loader.ts      # Config file loader
├── types/
│   ├── browser.ts            # Browser session interfaces
│   ├── config.ts             # Configuration types
│   └── report.ts             # Report types
└── dashboard/
    ├── server.ts             # Express server
    └── public/
        └── index.html        # Web UI
```

## Dependencies

### Production
- `@browserbasehq/sdk`: Browserbase API client
- `playwright`: Browser automation (local fallback)
- `openai`: OpenAI API client
- `express`: Web dashboard server
- `commander`: CLI interface
- `chalk`: Terminal styling
- `ora`: CLI spinners
- `zod`: Schema validation

### Development
- `typescript`: TypeScript compiler
- `tsx`: TypeScript execution
- `jest`: Testing framework
- `eslint`: Linting
- `prettier`: Code formatting

## Known Gaps vs Requirements

1. **Stagehand Integration**: Not implemented (Browserbase SDK only)
   - Impact: Medium - Stagehand provides AI-powered browser control
   - Status: Optional enhancement

2. **Vercel AI SDK**: Using OpenAI SDK directly instead
   - Impact: Low - Functionality equivalent, but not preferred framework
   - Status: Can be refactored if needed

3. **Input Schema Support**: No support for receiving control layout from game dev agent
   - Impact: Medium - Would improve interaction accuracy
   - Status: Future enhancement

4. **Lambda Deployment**: No Lambda-specific packaging
   - Impact: Low - Code is Lambda-ready, just needs packaging
   - Status: Can be added when needed

## Browser Providers

### BrowserbaseProvider
- Uses Browserbase SDK with CDP connection
- Remote headless browser
- Requires API key and quota
- Handles quota limits gracefully (falls back to local)

### LocalPlaywrightProvider
- Local Chromium browser via Playwright
- Free, no quota limits
- Supports visible mode (`SHOW_BROWSER=true`)
- Automatic fallback when Browserbase unavailable

