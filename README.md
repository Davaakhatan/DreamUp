# DreamUp Browser Game QA Pipeline

**Version:** 1.0  
**Date:** November 2025  
**Status:** ✅ Production Ready

An autonomous AI agent that tests browser-based games by simulating user interactions, capturing visual evidence, and evaluating playability metrics.

## Overview

DreamUp QA Agent is designed to automate quality assurance for browser games. It loads games in a headless browser using Browserbase CDP (Chrome DevTools Protocol), simulates gameplay interactions with real clicks and keypresses, captures screenshots and console logs, and uses GPT-4o Vision AI to evaluate playability.

## Features

- 🎮 **Browser Automation**: Uses Browserbase with CDP integration via Playwright for reliable headless browser control
- 🤖 **AI Evaluation**: GPT-4o Vision analyzes screenshots for accurate playability assessment
- 📸 **Evidence Capture**: Timestamped screenshots (5+ per test) and console logs for every test
- 🖱️ **Real Interactions**: Actual clicks, keypresses, and navigation via CDP
- 🔄 **Retry Logic**: Handles failures gracefully with automatic retries
- ⚙️ **Configurable Actions**: JSON-based configuration for custom test sequences
- 📊 **Structured Reports**: JSON output with scores, issues, and evidence
- 🌐 **Modern Dashboard**: Real-time web dashboard with pipeline animation and test results
- 🎯 **Smart Button Detection**: XPath-based text matching and CSS selector detection

## Prerequisites

- Node.js 18+ and npm
- Browserbase API key ([Get one here](https://www.browserbase.com))
- OpenAI API key with GPT-4o access ([Get one here](https://platform.openai.com))
- Browserbase Project ID (optional, can be set in environment variables)

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd DreamUp
```

2. Install dependencies:
```bash
npm install
```

3. Build the project:
```bash
npm run build
```

4. Set environment variables:
```bash
export BROWSERBASE_API_KEY=your_browserbase_key
export OPENAI_API_KEY=your_openai_key
export BROWSERBASE_PROJECT_ID=your_project_id  # Optional
```

Or create a `.env` file in the project root:
```
BROWSERBASE_API_KEY=your_browserbase_key
OPENAI_API_KEY=your_openai_key
BROWSERBASE_PROJECT_ID=your_project_id
```

**Important**: Never commit your `.env` file to Git. It's automatically ignored.

## Usage

### CLI Command

Test a game URL:
```bash
npm run cli test <game-url>
```

With custom configuration:
```bash
npm run cli test <game-url> --config config.json --output ./results
```

### Example

```bash
npm run cli test https://example.com/game.html
```

### Web Dashboard

Start the web dashboard to view test results:
```bash
npm run cli dashboard
```

Or with custom port and output directory:
```bash
npm run cli dashboard --port 8080 --output ./output
```

Then open your browser to `http://localhost:3000` (or your custom port) to view a beautiful, modern dashboard with:
- 📊 Real-time statistics (total tests, pass rate, average score, issues)
- 📸 Screenshot galleries with hover previews
- 🐛 Issue tracking with severity indicators
- 📈 Playability scores with progress bars
- 🎨 Modern, minimalist dark-themed UI
- 🎬 Real-time pipeline animation showing test progress
- 🌐 Browser simulation showing actual test execution
- ⚡ Live test execution directly from the dashboard

### Configuration File

Create a JSON configuration file to customize test actions:

```json
{
  "actions": [
    {"type": "wait", "duration": 2},
    {"type": "click", "selector": "button.start"},
    {"type": "keypress", "key": "ArrowRight", "repeat": 5},
    {"type": "screenshot", "label": "gameplay"}
  ],
  "timeouts": {
    "load": 30,
    "action": 10,
    "total": 300
  }
}
```

### Programmatic Usage

```typescript
import { QAAgent, BrowserbaseProvider, EvidenceCapture, Evaluator, loadConfig } from './src/index.js';

const config = await loadConfig();
const browserProvider = new BrowserbaseProvider();
const session = await browserProvider.createSession();

const evidenceCapture = new EvidenceCapture('./output');
const evaluator = new Evaluator();

const agent = new QAAgent(session, config, evidenceCapture, evaluator);
const report = await agent.testGame('https://example.com/game.html');

console.log(report);
```

## Output Structure

```
output/
├── screenshots/
│   ├── screenshot-2025-11-03T10-30-00-baseline.png
│   ├── screenshot-2025-11-03T10-30-05-after-movement.png
│   └── ...
├── logs/
│   └── console-2025-11-03T10-30-00.log
└── report-1699012200000.json
```

## Report Format

```json
{
  "status": "pass" | "fail" | "partial" | "error",
  "playability_score": 0-100,
  "issues": [
    {
      "severity": "critical" | "warning" | "info",
      "description": "Issue description",
      "confidence": 0.0-1.0
    }
  ],
  "screenshots": [
    {
      "filename": "screenshot-xxx.png",
      "timestamp": "2025-11-03T10:30:00Z",
      "label": "baseline"
    }
  ],
  "timestamp": "2025-11-03T10:30:00Z",
  "game_url": "https://example.com/game.html",
  "execution_time_seconds": 45.2,
  "metadata": {
    "console_errors": [],
    "console_warnings": [],
    "load_time_ms": 2500
  }
}
```

## Architecture

```
src/
├── agent/
│   ├── qa-agent.ts          # Main orchestrator
│   ├── interaction-engine.ts # Game interaction logic
│   ├── evidence-capture.ts   # Screenshot & log capture
│   └── evaluator.ts          # LLM-based evaluation
├── browser/
│   ├── browserbase-provider.ts # Browserbase integration
│   └── fallback-provider.ts    # Alternative providers
├── config/
│   ├── default-config.ts       # Default test configuration
│   └── config-loader.ts        # Config file loading
├── dashboard/
│   ├── server.ts               # Express server for dashboard
│   ├── public/
│   │   └── index.html          # Modern web UI
│   └── cli.ts                  # Dashboard CLI entry
├── utils/
│   └── cli-ui.ts              # CLI UI utilities (colors, spinners)
├── types/
│   ├── config.ts               # Configuration types
│   ├── report.ts               # Report types
│   └── browser.ts              # Browser types
├── cli.ts                       # CLI interface
└── index.ts                     # Main exports
```

## Error Handling

- **Load Failures**: Automatic retry up to 3 times with exponential backoff
- **Timeout Protection**: Maximum 5-minute execution time per game
- **Graceful Degradation**: Continues with partial data if screenshots fail
- **LLM Failures**: Falls back to heuristic-based evaluation

## Limitations

- Single-player games only (no multiplayer support)
- Desktop browser only (no mobile emulation)
- Basic interaction patterns (click, keyboard)
- Requires stable internet connection for API calls

## Testing

### Automated Test Suite

Run the comprehensive automated test suite:

```bash
./test-automated.sh
```

Or manually:
```bash
npm install
npm run build
npm test
npm run lint
```

### Manual Testing

Test with diverse game types:

1. **Simple Puzzle**: Basic click interactions
2. **Platformer**: Keyboard controls and physics
3. **Idle/Clicker**: Minimal interaction, persistent state
4. **Complex Game**: Multiple levels/screens

Find test games at: [itch.io HTML5 games](https://itch.io/games/html5)

## Development

```bash
# Development mode with auto-reload
npm run dev

# Linting
npm run lint

# Formatting
npm run format

# Build
npm run build
```

## Architecture Highlights

### Browser Automation
- Uses Browserbase SDK to create browser sessions
- Connects via Chrome DevTools Protocol (CDP) using Playwright
- Enables real screenshot capture, clicks, and keypresses
- Supports navigation, console log capture, and script evaluation

### AI Evaluation
- Uses GPT-4o (latest model) with vision capabilities
- Analyzes multiple screenshots per test session
- Generates structured JSON reports with confidence scores
- Provides detailed issue categorization (critical, warning, info)

### Dashboard Features
- Express.js backend serving test results
- Real-time test status polling
- Phase-based pipeline animation (load → capture → interact → analyze → report)
- Visual browser simulation showing actual test execution
- Auto-refreshing statistics and report listings

## Timeline

- **Day 1**: Setup + Basic Agent ✅
- **Day 2**: Interaction System ✅
- **Day 3**: LLM Evaluation ✅
- **Day 4**: Error Handling + Testing ✅
- **Day 5**: Polish + Documentation ✅

## Testing Status

✅ **Production Ready** - All core features implemented and tested
- Successfully tested with 10+ diverse browser games
- Screenshots capture working (5+ per test)
- Real browser interactions via CDP
- GPT-4o evaluation producing accurate scores (80-95/100 for working games)
- Dashboard displaying results correctly
- Error handling robust

## Future Enhancements (Optional)

- [ ] Batch testing mode for multiple URLs (via CLI)
- [ ] GIF recording of gameplay sessions
- [ ] Advanced metrics (FPS monitoring, load time analysis)
- [ ] Accessibility checks (WCAG compliance)
- [ ] Automated fix suggestions based on detected issues
- [ ] Test history and trend analysis
- [ ] Export reports in multiple formats (PDF, HTML)

## License

MIT

## Contact

For questions or issues, contact: matt.smith@superbuilders.school

