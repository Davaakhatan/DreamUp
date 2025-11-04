# Testing Input Schema

This guide shows how to test the input schema functionality.

## Quick Test

### Method 1: Using the Test Script

Run the automated test script:

```bash
npm run test:input-schema
```

This will:
1. Parse the input schema
2. Create a browser session
3. Run a test on 2048 game with the input schema
4. Show which keys were used from the schema

### Method 2: Using CLI with Input Schema File

Test with a specific game and input schema file:

```bash
# Using the provided 2048 schema
qa-agent test https://play2048.co/ --input-schema test-schema-2048.json

# Or with a custom schema
qa-agent test <game-url> --input-schema path/to/schema.json
```

### Method 3: Test with Visible Browser

To see the browser actions in real-time:

```bash
USE_LOCAL_BROWSER=true SHOW_BROWSER=true npm run test:input-schema
```

## What to Look For

When the input schema is working, you'll see console messages like:

```
🎮 Using input schema: ArrowRight -> ArrowRight (right)
🎮 Using input schema: ArrowDown -> ArrowDown (down)
```

This confirms the agent is:
1. Detecting arrow key actions
2. Looking up the direction in the input schema
3. Using the keys specified in the schema

## Example Input Schema

See `test-schema-2048.json` for a complete example:

```json
{
  "gameId": "2048",
  "gameName": "2048 Puzzle Game",
  "axes2D": [
    {
      "name": "Move",
      "bindings": [
        { "type": "key", "input": "ArrowUp" },
        { "type": "key", "input": "ArrowDown" },
        { "type": "key", "input": "ArrowLeft" },
        { "type": "key", "input": "ArrowRight" }
      ]
    }
  ]
}
```

## Testing Custom Games

Create an input schema for your game:

1. Identify the game's controls (actions, axes)
2. Create a JSON file following the format in `input-schema.example.json`
3. Run the test with your schema:

```bash
qa-agent test <your-game-url> --input-schema your-schema.json
```

## Verification

To verify the input schema is being used:

1. Check console output for "🎮 Using input schema" messages
2. Review the test report - it should show successful gameplay
3. Compare behavior with/without schema (schema should be more accurate)

## Troubleshooting

**No "Using input schema" messages:**
- Check that the schema file is valid JSON
- Verify the axis names match common patterns (Move, Movement, PlayerMove)
- Ensure the schema file path is correct

**Schema not affecting gameplay:**
- The schema only affects movement keys (arrow keys)
- Actions (like Jump, Shoot) need to be explicitly used in the config
- Check that your game uses the keys specified in the schema

**Schema parsing errors:**
- Validate JSON syntax
- Check that required fields are present (axes2D, bindings, etc.)
- See `input-schema.example.json` for reference format

