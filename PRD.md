# Product Requirements Document
## DreamUp Browser Game QA Pipeline

**Version:** 1.0  
**Date:** November 3, 2025  
**Status:** Production Ready

---

## 1. Executive Summary

### Problem Statement
DreamUp generates browser-based games using AI, but lacks automated quality assurance. Manual testing is slow, expensive, and doesn't scale to hundreds of generated games.

### Solution Overview
An autonomous AI agent that automatically tests browser games by simulating user interactions, capturing visual evidence, and evaluating playability metrics using AI.

### Business Value
- **Automation**: Eliminates manual QA testing for generated games
- **Scalability**: Test hundreds of games without human intervention
- **Feedback Loop**: Enables game-building AI to improve based on test results
- **Quality Assurance**: Catch broken games before release

---

## 2. Objectives & Success Criteria

### Primary Objectives
1. Automate QA testing for browser-based games
2. Provide AI-powered playability assessment
3. Generate structured reports for integration
4. Demonstrate production-ready AI agent architecture

### Success Criteria
- ✅ Successfully tests 3+ diverse browser games end-to-end
- ✅ Generates structured reports with 80%+ accuracy on playability assessment
- ✅ Handles common failure modes gracefully (crashes, slow loads, rendering issues)
- ✅ Clean, documented, modular codebase
- ✅ Production-ready UI/UX

---

## 3. Target Users

### Primary User
**DreamUp's Game-Building AI Agent** (automated consumer)
- Calls QA agent after generating games
- Uses JSON reports to determine if game should be published
- Integrates via programmatic API or CLI

### Secondary Users
- **Game Developers**: Review test results via web dashboard
- **QA Engineers**: Validate test results and refine test cases

---

## 4. Core Features

### 4.1 Browser Automation Agent
**Description**: Loads games in headless browser and simulates user interactions

**Requirements**:
- Load game from URL using Browserbase SDK
- Detect common UI patterns (start buttons, menus, game over screens)
- Execute gameplay sequences (clicks, keyboard input)
- Implement timeouts and retry logic (3 retries, 5 min max)

**Acceptance Criteria**:
- ✅ Loads games successfully
- ✅ Detects and clicks start/play buttons
- ✅ Simulates basic gameplay (arrow keys, spacebar, mouse clicks)
- ✅ Handles failures gracefully

### 4.2 Evidence Capture
**Description**: Captures visual and log evidence during test execution

**Requirements**:
- Take 3-5 timestamped screenshots per test session
- Save artifacts to structured output directory (`output/screenshots/`)
- Capture console logs and error messages
- Include timestamps and labels for all evidence

**Acceptance Criteria**:
- ✅ Screenshots saved with proper filenames
- ✅ Console logs captured and saved
- ✅ Evidence linked to test reports

### 4.3 AI Evaluation
**Description**: Uses LLM to analyze captured evidence and assess playability

**Requirements**:
- Use GPT-4 Vision to analyze screenshots
- Analyze console logs for errors/warnings
- Assess three key metrics:
  - Successful load
  - Responsive controls
  - Stability (no crashes)
- Output structured JSON with:
  - Status: `pass` | `partial` | `fail`
  - Playability score: 0-100
  - Issues array with severity and descriptions
  - Confidence scores

**Acceptance Criteria**:
- ✅ AI generates accurate playability scores
- ✅ Issues correctly categorized by severity
- ✅ Structured JSON output format

### 4.4 Execution Interface
**Description**: Provides ways to run tests and view results

**Requirements**:
- CLI command: `qa-agent test <game-url> [--config <file>]`
- Web dashboard for viewing test results
- Structured output: JSON reports
- Lambda-ready architecture (modular, TypeScript)

**Acceptance Criteria**:
- ✅ CLI runs tests successfully
- ✅ Dashboard displays results with modern UI
- ✅ JSON reports are machine-readable

---

## 5. Technical Architecture

### 5.1 Technology Stack
- **Language**: TypeScript
- **Runtime**: Node.js / Bun
- **Browser Automation**: Browserbase SDK
- **AI**: OpenAI GPT-4 Vision
- **Web Framework**: Express.js
- **UI**: Vanilla HTML/CSS/JS (no frameworks)

### 5.2 System Components

```
┌─────────────────────────────────────────────┐
│  CLI Interface / Web Dashboard              │
└──────────────────┬──────────────────────────┘
                   │
┌──────────────────▼──────────────────────────┐
│  QAAgent (Orchestrator)                     │
└──────┬──────────────┬──────────────┬────────┘
       │              │              │
┌──────▼─────┐ ┌─────▼──────┐ ┌─────▼──────┐
│ Browser    │ │ Evidence   │ │ Evaluator  │
│ Provider   │ │ Capture    │ │ (AI)       │
└────────────┘ └─────────────┘ └────────────┘
```

### 5.3 Data Flow

1. **Input**: Game URL
2. **Browser Automation**: Open browser, navigate to URL
3. **Evidence Capture**: Screenshots, console logs
4. **Interaction**: Simulate gameplay
5. **AI Analysis**: GPT-4 Vision evaluates evidence
6. **Output**: JSON report with scores, issues, screenshots

---

## 6. Out of Scope

### Explicitly Excluded
- ❌ Multiplayer or network-dependent games
- ❌ Mobile browser emulation
- ❌ Security/performance testing
- ❌ Production integration with DreamUp systems (prototype only)
- ❌ GIF recording (optional stretch feature)
- ❌ FPS monitoring (optional stretch feature)

---

## 7. Deliverables

### Required
1. ✅ **Source Code**: GitHub repository with clear structure
2. ✅ **Documentation**: README with setup, usage, architecture
3. ✅ **Test Results**: QA reports for 3+ sample games with screenshots
4. ✅ **Demo**: Dashboard UI showing test results

### Optional (Stretch Features)
- Batch Testing: Sequential testing of multiple URLs
- Advanced Metrics: FPS monitoring, load time analysis
- Feedback Loop: Generate potential fixes for detected issues

---

## 8. Constraints & Assumptions

### Constraints
- Maximum 5 minute execution time per game
- Single-player browser games only
- Requires Browserbase API key
- Requires OpenAI API key

### Assumptions
- Games are web-hosted (URL accessible)
- Games use standard browser controls (click, keyboard)
- Games don't require authentication
- Screenshots sufficient for visual analysis

---

## 9. Integration Points

### Current Integration
- **Input**: Game URL (command-line or web form)
- **Output**: JSON report with status, scores, issues, screenshots

### Future Integration
- Lambda function for game-building agent
- Direct API integration with DreamUp pipeline
- Webhook notifications on test completion

---

## 10. Success Metrics

### Quantitative Metrics
- Test success rate: 80%+ accurate playability assessment
- Execution time: < 5 minutes per game
- Screenshot capture: 3-5 screenshots per test
- Report generation: 100% successful (with fallback)

### Qualitative Metrics
- Clean, modular codebase
- Production-ready UI/UX
- Comprehensive error handling
- Clear documentation

---

## 11. Timeline & Milestones

### Completed Milestones ✅
- Day 1: Setup + Basic Agent (Browser launches, navigates, takes screenshots)
- Day 2: Interaction System (Basic game interaction working)
- Day 3: LLM Evaluation (AI assessment integrated, JSON output)
- Day 4: Error Handling + Testing (Robust failure modes, tested on games)
- Day 5: Polish + Documentation (README, code cleanup, dashboard)

### Current Status
✅ **Production Ready** - All core features implemented and tested

---

## 12. Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Agent loops infinitely | High | Max action count, total timeout (5 min) |
| LLM gives inconsistent results | Medium | Structured prompts, confidence thresholds |
| Games don't load in headless mode | High | Test with headed mode, screenshot comparison |
| API costs exceed budget | Low | Cache responses, use cheaper models for iteration |

---

**Document Status**: ✅ Approved - Production Ready

