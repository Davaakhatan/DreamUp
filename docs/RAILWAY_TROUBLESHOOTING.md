# Railway Troubleshooting Guide

## Common Issues and Fixes

### Issue: "Application failed to respond"

**Symptoms:**
- Build succeeds but app shows "Application failed to respond"
- Railway shows "Completed" but URL doesn't work

**Solutions:**

#### 1. Check Deploy Logs (Not Build Logs)

In Railway dashboard:
- Go to your service → **Deploy Logs** tab (not Build Logs)
- Look for errors like:
  - "Cannot find module"
  - "Port already in use"
  - "EADDRINUSE"
  - Any startup errors

#### 2. Verify Start Command

Railway should use:
- **Start Command**: `node dist/dashboard/prod.js`
- Or Railway auto-detects from `package.json` → `"start"` script

Check in Railway → Settings → Deploy:
- Make sure start command is correct

#### 3. Check Environment Variables

Railway → Variables tab, verify:
- ✅ `OPENAI_API_KEY` is set to a **REAL API KEY** (not placeholder like `your_openai_api_key_here`)
- ✅ `PORT` is set (Railway sets this automatically, but verify)
- ✅ Either:
  - `USE_LOCAL_BROWSER=true` (to use free local Playwright), OR
  - `BROWSERBASE_API_KEY` and `BROWSERBASE_PROJECT_ID` are set to real values (not placeholders)

**Common Error:** Placeholder values in environment variables!
- ❌ `OPENAI_API_KEY=your_openai_api_key_here` → Will fail!
- ✅ `OPENAI_API_KEY=sk-proj-...` (real key) → Will work!

**To fix:**
1. Go to Railway → Variables tab
2. Click on each variable with placeholder values
3. Replace with your actual API keys:
   - Get OpenAI key from: https://platform.openai.com/api-keys
   - Get Browserbase key from: https://www.browserbase.com (if using Browserbase)
4. Save and Railway will auto-redeploy

#### 4. Verify Port Binding

The server must bind to `0.0.0.0` (not `localhost`):
- ✅ Fixed in latest code: Server now binds to `0.0.0.0`
- If still having issues, check deploy logs for port errors

#### 5. Check Output Directory Permissions

If you see file system errors:
- Railway provides writable `/tmp` directory
- Or use `./output` (should work by default)

### Issue: Playwright Not Working

**Symptoms:**
- Tests fail with "Browser not found" errors
- Playwright can't find Chromium

**Solution:**

Add to `package.json`:
```json
{
  "scripts": {
    "postinstall": "npx playwright install --with-deps chromium"
  }
}
```

Then redeploy on Railway.

### Issue: Timeout Errors

**Symptoms:**
- Tests start but timeout
- Railway kills the process

**Solution:**
- Railway doesn't have strict timeouts like Vercel
- But check if your tests are taking too long
- Consider increasing timeouts in your config

### Issue: Memory Errors

**Symptoms:**
- "Out of memory" errors
- Process killed

**Solution:**
- Railway free tier has memory limits
- Upgrade to Hobby plan ($5/month) for more memory
- Or optimize your code to use less memory

## How to Check Logs

1. **Build Logs**: Shows Docker build process
2. **Deploy Logs**: Shows application startup (CHECK THIS!)
3. **HTTP Logs**: Shows incoming requests

**Most important**: Check **Deploy Logs** for runtime errors!

## Quick Debugging Steps

1. ✅ Check **Deploy Logs** (not Build Logs)
2. ✅ Verify environment variables are set
3. ✅ Check start command is correct
4. ✅ Verify port binding (should be 0.0.0.0)
5. ✅ Check for missing dependencies
6. ✅ Verify Railway URL is accessible

## Getting Help

If still stuck:
1. Copy the error from **Deploy Logs**
2. Check Railway's status page
3. Railway Help Station: https://railway.app/help

