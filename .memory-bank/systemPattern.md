# System Pattern: DreamUp Browser Game QA Pipeline

## Core Pattern
**Autonomous Browser Game Testing Agent** - An AI-powered QA system that simulates user interactions, captures visual evidence, and evaluates playability metrics for browser-based games.

## Architecture Overview

```
┌─────────────────────────────────────────────┐
│  CLI Interface / Web Dashboard              │
└──────────────────┬──────────────────────────┘
                   │
┌──────────────────▼──────────────────────────┐
│  QAAgent (Orchestrator)                   │
│  - Coordinates test flow                   │
│  - Manages timeouts and retries            │
└──────┬──────────────┬──────────────┬────────┘
       │              │              │
┌──────▼─────┐ ┌─────▼──────┐ ┌─────▼──────┐
│ Browser    │ │ Evidence   │ │ Evaluator  │
│ Provider   │ │ Capture    │ │ (AI)       │
│            │ │            │ │            │
│ - Browserbase│ │ - Screenshots│ │ - GPT-4o   │
│ - Local     │ │ - Console  │ │ - Vision   │
│   Playwright│ │   Logs     │ │   Analysis │
└──────┬─────┘ └─────────────┘ └────────────┘
       │
┌──────▼──────────────────────────────┐
│  Interaction Engine                  │
│  - Modal detection & dismissal       │
│  - Button detection (XPath/CSS)      │
│  - Action execution (click/keypress) │
│  - Game state verification           │
│  - Iframe/cookie/ad handling         │
└──────────────────────────────────────┘
```

## Key Components

### 1. Browser Automation Layer
- **BrowserbaseProvider**: Primary provider using Browserbase SDK with CDP
- **LocalPlaywrightProvider**: Free fallback using local Chromium
- **Features**: Navigation, screenshots, console logs, clicks, keypresses, iframe handling

### 2. Interaction Engine
- **Modal Handling**: Detects and dismisses modals (tutorial, new game, confirmation)
- **Button Detection**: XPath-based text matching, CSS selector fallback
- **Action Execution**: Clicks, keypresses (arrow keys, WASD, spacebar)
- **Game State Verification**: Checks if game is actually playing (scores, tiles, canvas)
- **Site-Specific Handling**: Iframes, cookie consent, ads, age verification, game listings

### 3. Evidence Capture
- **Screenshots**: Timestamped, labeled (initial-load, gameplay, final-state)
- **Console Logs**: Errors, warnings, filtered for extension noise
- **Artifact Storage**: Structured output directory (`output/screenshots/`, `output/logs/`)

### 4. AI Evaluation
- **Vision Analysis**: GPT-4o analyzes screenshots for visual issues
- **Text Analysis**: Console logs analyzed for errors/warnings
- **Structured Output**: JSON report with status, score, issues, confidence

### 5. Execution Interface
- **CLI**: `qa-agent test <game-url> [--config <file>]`
- **Web Dashboard**: Real-time pipeline animation, test results, screenshot modal
- **Programmatic**: Exported `QAAgent` class for Lambda integration

## Architecture Principles

### Modular Design
- Separated concerns: browser, interactions, evaluation, reporting
- Provider pattern for browser abstraction (Browserbase vs Local)
- Dependency injection for testability

### Configuration-Driven
- Action sequences defined in JSON config
- Timeouts configurable per test
- Custom config files supported

### Graceful Degradation
- Handles failures without crashing
- Continues with partial data
- Fallback providers (Browserbase → Local)
- Error reports generated even on failure

### Evidence-Based
- All assessments backed by timestamped screenshots and logs
- Screenshots filtered for validity
- Console logs captured and analyzed

### Generic Game Support
- No hard-coded game-specific logic
- Pattern-based detection (modals, buttons, selection screens)
- Works with diverse game types (puzzle, platformer, idle, etc.)

## Data Flow

1. **Input**: Game URL (CLI or web dashboard)
2. **Initialize**: Create browser session, load config
3. **Navigate**: Load game URL, wait for render
4. **Handle Site Issues**: Iframes, cookies, ads, game listings
5. **Ensure Game Playing**: Detect and dismiss modals, start game
6. **Capture Evidence**: Initial screenshot
7. **Interact**: Execute action sequence (clicks, keypresses)
8. **Monitor**: Capture screenshots after each action, collect console logs
9. **Evaluate**: AI analyzes screenshots and logs
10. **Report**: Generate JSON report with status, score, issues
11. **Output**: Save report, display results

## Success Patterns

### Timeouts
- Maximum 5 minute execution time per game
- 30 second load timeout
- 20 second action timeout
- Automatic test reset after 5 minutes

### Retry Logic
- 3 retry attempts for failed loads
- Graceful fallback to local browser on Browserbase quota limits
- Retry screenshot capture on failure

### Evidence Collection
- 3-5 screenshots per test session
- Screenshots labeled with action context
- Console logs filtered for relevance
- Invalid screenshots excluded from reports

### Output Format
- Structured JSON with status, playability_score, issues, screenshots
- Confidence scores for each issue
- Timestamped evidence
- Machine-readable format for integration

## Known Limitations

1. **Input Schema Support**: Not yet implemented - would improve interaction accuracy
2. **Stagehand Integration**: Not implemented - optional enhancement
3. **Vercel AI SDK**: Using OpenAI SDK directly - functional but not preferred framework
4. **Lambda Packaging**: Code is Lambda-ready but no specific packaging config

