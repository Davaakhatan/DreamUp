# Product Context: DreamUp Browser Game QA Pipeline

## Business Purpose
- Automate QA testing for DreamUp's AI-generated games
- Enable feedback loops for game-building agent improvement
- Demonstrate production-ready AI agent architecture

## Target Users
- **Primary**: DreamUp's game-building AI agent (automated consumer)
  - Calls QA agent after generating games
  - Uses JSON reports to determine if game should be published
  - Integrates via programmatic API or CLI
- **Secondary**: Game developers using DreamUp (via integration)
- **Tertiary**: QA engineers reviewing test results

## Success Metrics
- Successfully tests 3+ diverse browser games end-to-end
- 80%+ accuracy on playability assessment
- Graceful handling of common failure modes
- Clean, documented, modular codebase

## Game Engine Context

### DreamUp Game Engine Architecture
The DreamUp game engine uses a sophisticated scene and input system:

**Scene Stack**
- Canvas2D & Canvas3D scenes: Full ECS runtime with physics, rendering, game logic
- UI scenes: Pure DOM elements
- Composite scenes: Layer multiple child scenes together
- Common pattern: Composite scene with 2D/3D game scene + UI overlay for HUD

**Input System**
- **Two-layer architecture**: Low-level hardware capture (keys, mouse, pointer) + high-level gameplay abstractions
- **Actions**: Discrete button events (Jump, Shoot, etc.)
  - Map multiple inputs to named gameplay events
  - Track states: pressed, down, released, hold duration
- **Axes**: Continuous values
  - 1D axes: Return [-1, 1] with smoothing and opposite-direction cancellation
  - 2D axes: Return vectors {x, y} with diagonal normalization
  - Bound to WASD, arrow keys, virtual joysticks, D-pads
- **Decoupling**: Game logic queries abstractions via scene's InputManager
  - Multiple input sources trigger same action/axis
  - Keyboard, touch, and virtual controls work interchangeably

### Input Schema Integration (Future)
- **Game Dev Agent**: Picks the input schema as it plans the game
- **QA Agent**: Should receive control layout as an input prompt
- **Current Status**: Not yet implemented - would improve interaction accuracy

## Scope Boundaries

### In Scope
- Single-player browser games
- Basic interaction patterns (click, keyboard)
- Visual evidence capture (screenshots, console logs)
- AI-based evaluation (GPT-4o Vision)
- Generic game support (no hard-coding)

### Out of Scope
- Multiplayer games
- Mobile browser emulation
- Security/performance testing
- Production integration (prototype only)
- GIF recording, FPS monitoring (optional stretch features)

## Integration Points

### Current Integration
- **Input**: Game URL (command-line or web form)
- **Output**: JSON report with status, scores, issues, screenshots
- **Format**: `{status, playability_score, issues[], screenshots[], timestamp}`

### Future Integration
- **Lambda Function**: For game-building agent integration
- **Input Schema**: Receive control layout from game dev agent
- **Direct API**: Integration with DreamUp pipeline
- **Webhook Notifications**: On test completion

