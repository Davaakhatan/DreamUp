# Project Brief: DreamUp Browser Game QA Pipeline

**Version:** 1.1  
**Date:** November 3, 2025  
**Status:** Production Ready

## Overview

DreamUp is a general AI game generator that creates browser-based games. This project builds an autonomous AI agent that tests these games by simulating user interactions, capturing visual evidence, and evaluating playability metrics.

## Objective

Build an AI agent that autonomously tests browser-based games by:
- Simulating user interactions (clicks, keyboard input)
- Capturing visual evidence (screenshots, console logs)
- Evaluating playability metrics using AI
- Working with any web-hosted game URL

## Business Value

- **Automation**: Eliminates manual QA testing for generated games
- **Scalability**: Test hundreds of games without human intervention
- **Feedback Loop**: Enables game-building AI to improve based on test results
- **Quality Assurance**: Catch broken games before release

## Success Criteria

- ✅ Successfully tests 3+ diverse browser games end-to-end
- ✅ Generates structured reports with 80%+ accuracy on playability assessment
- ✅ Handles common failure modes gracefully (crashes, slow loads, rendering issues)
- ✅ Clean, documented, modular codebase
- ✅ Production-ready UI/UX

## Core Requirements

### Browser Automation Agent
- Load game from URL
- Detect and handle common UI patterns (start buttons, menus, game over screens)
- Walk through the game based on the controls it finds
- Implement timeouts and retry logic

### Evidence Capture
- Take 3-5 timestamped screenshots per test session
- Save artifacts to structured output directory
- Include console logs and error messages

### AI Evaluation
- Use LLM to analyze screenshots and logs
- Assess: successful load, responsive controls, stability
- Output structured JSON with pass/fail, confidence scores, and issue descriptions

### Execution Interface
- Lambda-ready architecture (TypeScript file execution: `bun run qa.ts`, `npx tsx qa.ts`)
- CLI command: `qa-agent <game-url>`
- Structured output: `{status, playability_score, issues[], screenshots[], timestamp}`

## Game Engine Context

The DreamUp game engine uses:
- **Scene Stack**: Canvas2D/Canvas3D scenes with ECS runtime, UI scenes, Composite scenes
- **Input System**: Two-layer architecture with low-level hardware capture and high-level gameplay abstractions
  - **Actions**: Discrete button events (Jump, Shoot, etc.)
  - **Axes**: Continuous values (1D: -1 to 1, 2D: normalized vectors)
  - **Input Schema**: Game dev agent provides control layout as input prompt to QA agent

## Technical Stack (Requirements)

- **Browser**: Browserbase w/ Stagehand (recommended) or alternative
- **Language**: TypeScript preferred
- **LLM Framework**: Vercel's AI SDK preferred
- **Runtime**: Node.js / Bun

## Out of Scope

- Multiplayer or network-dependent games
- Mobile browser emulation
- Security/performance testing
- Production integration with DreamUp systems (prototype only)
- GIF recording, FPS monitoring (optional stretch features)

## Test Cases

Validate against diverse game types:
- Simple Puzzle (click interactions)
- Platformer (keyboard controls, physics)
- Idle/Clicker (minimal interaction)
- Broken Game (failure detection)
- Complex Game (multiple levels/screens)

Test games available at:
- itch.io/games/html5
- kongregate.com
- html5games.com

