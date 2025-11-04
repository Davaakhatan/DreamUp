/**
 * Browserbase provider implementation for browser automation
 */

import { Browserbase } from '@browserbasehq/sdk';
import { chromium } from 'playwright-core';
import type {
  BrowserProvider,
  BrowserSession,
  BrowserOptions,
  ConsoleLog,
} from '../types/browser.js';

export class BrowserbaseProvider implements BrowserProvider {
  private client: any; // Browserbase SDK may have different API structure
  private apiKey: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.BROWSERBASE_API_KEY || '';
    if (!this.apiKey) {
      throw new Error(
        'BROWSERBASE_API_KEY environment variable is required. Get your key at https://www.browserbase.com'
      );
    }
    this.client = new Browserbase({ apiKey: this.apiKey });
  }

  async createSession(options: BrowserOptions = {}): Promise<BrowserSession> {
    try {
      // Browserbase SDK createSession method
      const session = await this.client.createSession({
        projectId: process.env.BROWSERBASE_PROJECT_ID || undefined,
      });

      if (!session) {
        console.error('Browserbase createSession returned null/undefined');
        throw new Error('Failed to create browser session: API returned null/undefined');
      }

      // Log session structure for debugging
      console.log('Session response keys:', Object.keys(session));
      console.log('Session ID:', session.id);
      console.log('Session connectUrl:', session.connectUrl);
      console.log('Session wsUrl:', (session as any).wsUrl);

      const sessionId = session.id || (session as any).sessionId || (session as any).session_id;
      
      // Check if this is an error response (e.g., 429 Too Many Requests)
      if ('statusCode' in session && 'error' in session) {
        const errorResponse = session as { statusCode: number; error: string; message: string };
        if (errorResponse.statusCode === 429) {
          throw new Error(
            `Browserbase session limit exceeded: ${errorResponse.message}\n` +
            `Please close any existing browser sessions or wait a few moments before retrying.`
          );
        }
        if (errorResponse.statusCode === 402) {
          throw new Error(
            `Browserbase quota limit reached: ${errorResponse.message}\n` +
            `Your free plan browser minutes have been exhausted.\n` +
            `Please upgrade your account at https://browserbase.com/plans or wait for quota reset.`
          );
        }
        throw new Error(
          `Browserbase API error (${errorResponse.statusCode}): ${errorResponse.error}\n` +
          `Message: ${errorResponse.message}`
        );
      }

      if (!sessionId) {
        console.error('Session object structure:', JSON.stringify(session, null, 2));
        throw new Error(`Failed to create browser session: No session ID found. Response keys: ${Object.keys(session).join(', ')}`);
      }

      // Store connectUrl if provided in session response
      const connectUrl = session.connectUrl || (session as any).wsUrl || (session as any).connect_url || null;

      console.log(`Browserbase session created: ${sessionId}`);

      return new BrowserbaseSession(this.client, sessionId, connectUrl, options);
    } catch (error) {
      console.error('Browserbase createSession error:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      // Check for network/timeout errors
      const isNetworkError = errorMessage.includes('fetch failed') || 
                             errorMessage.includes('timeout') ||
                             errorMessage.includes('UND_ERR_CONNECT_TIMEOUT') ||
                             errorMessage.includes('ECONNREFUSED');
      
      if (isNetworkError) {
        throw new Error(
          `Network error connecting to Browserbase: ${errorMessage}\n` +
          `This is likely a temporary network issue. Please:\n` +
          `1. Check your internet connection\n` +
          `2. Wait a few moments and try again\n` +
          `3. Verify Browserbase service is accessible`
        );
      }
      
      const errorDetails = error instanceof Error && 'response' in error 
        ? JSON.stringify((error as any).response, null, 2) 
        : '';
      
      throw new Error(
        `Failed to create browser session: ${errorMessage}${errorDetails ? '\nDetails: ' + errorDetails : ''}\n` +
        `Please verify:\n` +
        `1. BROWSERBASE_API_KEY is set correctly in .env\n` +
        `2. Your Browserbase account is active\n` +
        `3. You have available browser hours/quota`
      );
    }
  }
}

class BrowserbaseSession implements BrowserSession {
  private currentUrl: string = 'about:blank';
  private browser: any = null;
  private page: any = null;
  private cdpSession: any = null;
  private connectUrl: string | null = null;
  
  constructor(
    private client: Browserbase,
    public sessionId: string,
    connectUrl: string | null,
    private options: BrowserOptions
  ) {
    this.connectUrl = connectUrl;
  }
  
  private async ensureCDPConnection(): Promise<void> {
    if (this.page && this.cdpSession) {
      return; // Already connected
    }
    
    try {
      // If we don't have connectUrl yet, try to get it
      if (!this.connectUrl) {
        // Method 1: Try getDebugConnectionURLs
        try {
          const debugUrls = await this.client.getDebugConnectionURLs(this.sessionId);
          this.connectUrl = debugUrls?.wsUrl || null;
        } catch (err1) {
          console.warn('getDebugConnectionURLs failed:', err1);
        }
        
        // Method 2: Try sessions.get
        if (!this.connectUrl) {
          try {
            const sessionInfo = await (this.client as any).sessions?.get?.(this.sessionId);
            this.connectUrl = sessionInfo?.connectUrl || sessionInfo?.wsUrl || null;
          } catch (err2) {
            console.warn('sessions.get failed:', err2);
          }
        }
        
        // Method 3: Try sessions.retrieve
        if (!this.connectUrl) {
          try {
            const sessionInfo = await (this.client as any).sessions?.retrieve?.(this.sessionId);
            this.connectUrl = sessionInfo?.connectUrl || sessionInfo?.wsUrl || null;
          } catch (err3) {
            console.warn('sessions.retrieve failed:', err3);
          }
        }
      }
      
      if (!this.connectUrl) {
        throw new Error('Could not get Browserbase CDP connection URL. Make sure the session is active.');
      }
      
      console.log(`Connecting to Browserbase CDP at: ${this.connectUrl.substring(0, 50)}...`);
      
      // Connect to Browserbase via CDP
      this.browser = await chromium.connectOverCDP(this.connectUrl, {
        timeout: 30000,
      });
      
      const contexts = this.browser.contexts();
      if (contexts.length === 0) {
        throw new Error('No browser contexts available after CDP connection');
      }
      
      const defaultContext = contexts[0];
      const pages = defaultContext.pages();
      this.page = pages.length > 0 ? pages[0] : await defaultContext.newPage();
      
      // Create CDP session for faster operations
      this.cdpSession = await defaultContext.newCDPSession(this.page);
      
      console.log('CDP connection established successfully');
    } catch (error) {
      console.error('CDP connection failed:', error);
      const errorMsg = error instanceof Error ? error.message : String(error);
      throw new Error(`CDP connection failed: ${errorMsg}. Please check your Browserbase API key and session status.`);
    }
  }

  async navigate(url: string): Promise<void> {
    // Store current URL
    this.currentUrl = url;
    
    try {
      // Ensure CDP connection
      await this.ensureCDPConnection();
      
      // Navigate using Playwright with more lenient settings
      // Use 'domcontentloaded' instead of 'networkidle' - games often have ads/scripts that never finish loading
      if (this.page) {
        try {
          // Try with domcontentloaded first (faster, more reliable)
          await this.page.goto(url, { 
            waitUntil: 'domcontentloaded', 
            timeout: 45000 // Increased timeout to 45s
          });
          await this.wait(2000); // Wait for game to initialize
        } catch (timeoutError) {
          // If domcontentloaded times out, try with commit (even more lenient)
          console.warn('Navigation timeout with domcontentloaded, trying commit...');
          try {
            await this.page.goto(url, { 
              waitUntil: 'commit', 
              timeout: 60000 // 60s for commit
            });
            await this.wait(3000); // Longer wait if we had to use commit
          } catch (commitError) {
            // Last resort: navigate without waiting
            console.warn('Navigation failed, attempting without wait...');
            await this.page.goto(url, { timeout: 10000 }).catch(() => {
              // Ignore final error - page might still be usable
            });
            await this.wait(3000);
          }
        }
      } else {
        // Fallback: try Browserbase SDK method
        await this.client.loadURL(url, { sessionId: this.sessionId });
        await this.wait(3000);
      }
    } catch (error) {
      console.warn('Navigation warning:', error instanceof Error ? error.message : String(error));
      // Continue anyway - page might still load
      await this.wait(3000);
    }
  }

  async screenshot(): Promise<Buffer> {
    try {
      // Ensure CDP connection
      await this.ensureCDPConnection();
      
      if (!this.cdpSession) {
        throw new Error('CDP session not available');
      }
      
      // CRITICAL: Force a repaint/reflow to ensure all tiles/animations are rendered
      // This fixes the issue where tiles exist in DOM but aren't visible in screenshots
      if (this.page) {
        try {
          // Force layout recalculation and repaint, and ensure tiles are visible
          await this.page.evaluate(`
            (() => {
              // First, check if tiles exist but are hidden, and force them visible
              const tileSelectors = [
                '[class*="tile"]',
                '[class*="cell"]',
                '[class*="grid-cell"]',
                '.tile-container > *',
              ];
              
              for (const selector of tileSelectors) {
                try {
                  const elements = document.querySelectorAll(selector);
                  elements.forEach(el => {
                    const text = (el.textContent || el.innerText || '').trim();
                    if (text && text !== '' && text !== '0') {
                      const style = window.getComputedStyle(el);
                      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
                        // Force visibility
                        (el as HTMLElement).style.display = 'block';
                        (el as HTMLElement).style.visibility = 'visible';
                        (el as HTMLElement).style.opacity = '1';
                        (el as HTMLElement).style.zIndex = '10';
                      }
                    }
                  });
                } catch (e) {
                  // Continue
                }
              }
              
              // Force reflow by accessing layout properties
              void document.body.offsetHeight;
              
              // Wait for CSS animations/transitions to complete
              // Most games use transitions for tile animations (0.1s - 0.3s)
              return new Promise(resolve => {
                // Check if any animations are running
                const animations = document.getAnimations();
                if (animations.length > 0) {
                  // Wait for the longest animation to complete
                  const maxDuration = Math.max(...Array.from(animations).map(a => {
                    const timing = a.effect?.getTiming();
                    return (timing?.duration || 0) * 1000;
                  }));
                  setTimeout(resolve, Math.max(maxDuration + 100, 300)); // Wait animation + 100ms buffer, min 300ms
                } else {
                  // No animations - wait a bit for any pending renders
                  setTimeout(resolve, 300);
                }
              });
            })()
          `);
        } catch (e) {
          // If evaluation fails, just wait a bit
          await this.wait(300);
        }
      } else {
        // Fallback: just wait
        await this.wait(300);
      }
      
      // Use CDP to capture screenshot (recommended by Browserbase)
      const result = await this.cdpSession.send('Page.captureScreenshot', {
        format: 'png',
        quality: 90,
        fullPage: false,
      });
      
      if (!result || !result.data) {
        throw new Error('CDP screenshot returned no data');
      }
      
      // Convert base64 to buffer
      const buffer = Buffer.from(result.data, 'base64');
      return buffer;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`Screenshot failed for session ${this.sessionId}:`, errorMessage);
      throw new Error(`Screenshot failed: ${errorMessage}`);
    }
  }

  async click(selector: string): Promise<void> {
    try {
      await this.ensureCDPConnection();
      
      // CRITICAL: Ensure page is focused before clicking
      if (this.page) {
        await this.page.bringToFront();
        await this.page.evaluate(`
          (() => {
            window.focus();
            document.body.focus();
          })()
        `);
        await this.wait(100);
      }
      
      if (this.page) {
        // Try Playwright click first
        try {
          await this.page.click(selector, { timeout: 5000, force: true });
        } catch (clickError) {
          // If Playwright click fails, try CDP click
          if (this.cdpSession) {
            try {
              const elementInfo = await this.page.evaluate((sel: string) => {
                // @ts-ignore - DOM types available in browser context
                const element = document.querySelector(sel);
                if (!element) return null;
                // @ts-ignore
                const rect = element.getBoundingClientRect();
                return {
                  x: rect.left + rect.width / 2,
                  y: rect.top + rect.height / 2,
                };
              }, selector);
              
              if (elementInfo) {
                // Use CDP to send mouse events
                await this.cdpSession.send('Input.dispatchMouseEvent', {
                  type: 'mousePressed',
                  x: elementInfo.x,
                  y: elementInfo.y,
                  button: 'left',
                  clickCount: 1,
                });
                await this.wait(50);
                await this.cdpSession.send('Input.dispatchMouseEvent', {
                  type: 'mouseReleased',
                  x: elementInfo.x,
                  y: elementInfo.y,
                  button: 'left',
                  clickCount: 1,
                });
                await this.wait(300);
              } else {
                throw new Error('Element not found');
              }
            } catch (cdpError) {
              // Final fallback: JavaScript click
              const clicked = await this.page.evaluate((sel: string) => {
                try {
                  // @ts-ignore - DOM types available in browser context
                  const element = document.querySelector(sel);
                  // @ts-ignore
                  if (element && element.offsetParent !== null) {
                    // Use multiple methods to ensure click works
                    // @ts-ignore
                    element.click();
                    // @ts-ignore
                    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                    // @ts-ignore
                    element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
                    // @ts-ignore
                    element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
                    return true;
                  }
                  return false;
                } catch (e) {
                  return false;
                }
              }, selector);
              
              if (!clicked) {
                throw new Error(`Element not found or not clickable: ${selector}`);
              }
            }
          } else {
            // Fallback: JavaScript click
            const clicked = await this.page.evaluate((sel: string) => {
              try {
                // @ts-ignore - DOM types available in browser context
                const element = document.querySelector(sel);
                // @ts-ignore
                if (element && element.offsetParent !== null) {
                  // @ts-ignore
                  element.click();
                  return true;
                }
                return false;
              } catch (e) {
                return false;
              }
            }, selector);
            
            if (!clicked) {
              throw new Error(`Element not found or not clickable: ${selector}`);
            }
          }
        }
        await this.wait(300); // Small delay after click
      } else {
        throw new Error('Page not available for click');
      }
    } catch (error) {
      console.warn(`Click failed on '${selector}':`, error instanceof Error ? error.message : String(error));
      await this.wait(500); // Delay anyway
    }
  }

  async clickByText(text: string, options: { exact?: boolean } = {}): Promise<boolean> {
    try {
      await this.ensureCDPConnection();
      
      if (!this.page) {
        return false;
      }

      // Strategy 1: Use Playwright's getByRole with name (most reliable)
      try {
        const button = this.page.getByRole('button', { name: new RegExp(text, 'i') });
        await button.waitFor({ state: 'visible', timeout: 2000 });
        await button.click({ timeout: 3000, force: false });
        await this.wait(500);
        return true;
      } catch (roleError) {
        // Continue to next strategy
      }

      // Strategy 2: Use getByText
      try {
        if (options.exact) {
          const locator = this.page.getByText(text, { exact: true });
          await locator.waitFor({ state: 'visible', timeout: 2000 });
          await locator.first().click({ timeout: 3000 });
        } else {
          const locator = this.page.getByText(text);
          await locator.waitFor({ state: 'visible', timeout: 2000 });
          await locator.first().click({ timeout: 3000 });
        }
        await this.wait(500);
        return true;
      } catch (getByTextError) {
        // Continue to next strategy
      }

      // Strategy 3: Use locator with filter
      try {
        const locator = this.page.locator('button').filter({ hasText: text });
        await locator.waitFor({ state: 'visible', timeout: 2000 });
        const count = await locator.count();
        if (count > 0) {
          await locator.first().click({ timeout: 3000 });
          await this.wait(500);
          return true;
        }
      } catch (locatorError) {
        // Continue to fallback
      }

      // Strategy 4: Try XPath-based locator
      try {
        const xpath = `//button[contains(translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), '${text.toLowerCase()}')]`;
        const locator = this.page.locator(xpath);
        await locator.waitFor({ state: 'visible', timeout: 2000 });
        await locator.first().click({ timeout: 3000 });
        await this.wait(500);
        return true;
      } catch (xpathError) {
        // Continue to final fallback
      }

      // Final fallback: JavaScript click (less reliable but sometimes necessary)
      // @ts-ignore - DOM types available in browser context
      const clicked = await this.page.evaluate((targetText: string) => {
        // @ts-ignore
        const buttons = Array.from(document.querySelectorAll('button'));
        // Normalize target text (remove extra whitespace, newlines)
        const normalizedTarget = targetText.toLowerCase().replace(/\s+/g, ' ').trim();
        
        for (const btn of buttons) {
          // @ts-ignore
          const btnElement = btn;
          // @ts-ignore
          // Normalize button text (remove newlines, extra spaces)
          const btnText = (btnElement.textContent || btnElement.innerText || '')
            .replace(/\s+/g, ' ') // Replace all whitespace (including newlines) with single space
            .trim()
            .toLowerCase();
          
          // @ts-ignore
          if (btnElement.offsetParent !== null && btnText.includes(normalizedTarget)) {
            try {
              // @ts-ignore
              btnElement.click();
              return true;
            } catch (e) {
              // Try MouseEvent
              try {
                // @ts-ignore
                btnElement.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                return true;
              } catch (e2) {
                continue;
              }
            }
          }
        }
        return false;
      }, text);
      
      if (clicked) {
        await this.wait(500);
        return true;
      }
      
      return false;
    } catch (error) {
      console.warn(`Click by text failed for '${text}':`, error instanceof Error ? error.message : String(error));
      return false;
    }
  }

  async keypress(key: string): Promise<void> {
    try {
      await this.ensureCDPConnection();
      
      if (this.page) {
        // CRITICAL: Ensure page window is active and focused
        // This is essential for Browserbase remote sessions
        await this.page.evaluate(`
          (() => {
            // Focus the window
            window.focus();
            
            // Focus the document
            document.body.focus();
            
            // Ensure active element is body
            if (document.activeElement !== document.body) {
              document.body.focus();
            }
            
            // Trigger a focus event to ensure browser recognizes focus
            window.dispatchEvent(new Event('focus', { bubbles: true }));
            document.dispatchEvent(new Event('focus', { bubbles: true }));
          })()
        `);
        
        // Also use Playwright's focus method
        await this.page.bringToFront();
        await this.page.focus('body');
        
        // Wait for focus to settle
        await this.wait(200);
        
        // Map common keys to DOM key codes
        const keyMap: Record<string, string> = {
          'ArrowUp': 'ArrowUp',
          'ArrowDown': 'ArrowDown',
          'ArrowLeft': 'ArrowLeft',
          'ArrowRight': 'ArrowRight',
          'Space': ' ',
          'Enter': 'Enter',
          'Escape': 'Escape',
        };
        
        const keyToPress = keyMap[key] || key;
        
        // CRITICAL: Use CDP directly for more reliable keypress in remote sessions
        // This ensures events are properly sent even if Playwright methods fail
        if (this.cdpSession) {
          try {
            // Send keydown event via CDP
            await this.cdpSession.send('Input.dispatchKeyEvent', {
              type: 'keyDown',
              windowsVirtualKeyCode: this.getKeyCode(keyToPress),
              code: this.getKeyCodeString(keyToPress),
              key: keyToPress,
            });
            
            await this.wait(50);
            
            // Send keyup event via CDP
            await this.cdpSession.send('Input.dispatchKeyEvent', {
              type: 'keyUp',
              windowsVirtualKeyCode: this.getKeyCode(keyToPress),
              code: this.getKeyCodeString(keyToPress),
              key: keyToPress,
            });
            
            await this.wait(100);
          } catch (cdpError) {
            // Fallback to Playwright if CDP fails
            console.warn('CDP keypress failed, falling back to Playwright:', cdpError);
            await this.page.keyboard.down(keyToPress);
            await this.wait(50);
            await this.page.keyboard.up(keyToPress);
            await this.wait(100);
          }
        } else {
          // Fallback to Playwright if CDP not available
          await this.page.keyboard.down(keyToPress);
          await this.wait(50);
          await this.page.keyboard.up(keyToPress);
          await this.wait(100);
        }
      } else {
        throw new Error('Page not available for keypress');
      }
    } catch (error) {
      console.warn(`Keypress failed for '${key}':`, error instanceof Error ? error.message : String(error));
      await this.wait(100);
    }
  }

  /**
   * Get Windows virtual key code for a key
   */
  private getKeyCode(key: string): number {
    const keyCodes: Record<string, number> = {
      'ArrowUp': 38,
      'ArrowDown': 40,
      'ArrowLeft': 37,
      'ArrowRight': 39,
      ' ': 32, // Space
      'Enter': 13,
      'Escape': 27,
    };
    return keyCodes[key] || 0;
  }

  /**
   * Get key code string for a key
   */
  private getKeyCodeString(key: string): string {
    const keyCodeStrings: Record<string, string> = {
      'ArrowUp': 'ArrowUp',
      'ArrowDown': 'ArrowDown',
      'ArrowLeft': 'ArrowLeft',
      'ArrowRight': 'ArrowRight',
      ' ': 'Space',
      'Enter': 'Enter',
      'Escape': 'Escape',
    };
    return keyCodeStrings[key] || key;
  }

  async wait(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  async evaluate<T>(script: string): Promise<T> {
    try {
      await this.ensureCDPConnection();
      
      if (this.page) {
        const result = await this.page.evaluate(script);
        return result as T;
      } else {
        throw new Error('Page not available for evaluation');
      }
    } catch (error) {
      console.warn('Script evaluation failed:', error instanceof Error ? error.message : String(error));
      return undefined as T;
    }
  }

  async getConsoleLogs(): Promise<ConsoleLog[]> {
    // Inject console interceptor to capture logs
    try {
      const logs = await this.evaluate<Array<{ level: string; message: string; timestamp: number }>>(`
        (function() {
          if (!window.__qaConsoleLogs) {
            window.__qaConsoleLogs = [];
            const originalLog = console.log;
            const originalWarn = console.warn;
            const originalError = console.error;
            const originalInfo = console.info;

            function addLog(level, args) {
              window.__qaConsoleLogs.push({
                level: level,
                message: Array.from(args).map(arg => 
                  typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
                ).join(' '),
                timestamp: Date.now()
              });
            }

            console.log = function(...args) {
              originalLog.apply(console, args);
              addLog('log', args);
            };
            console.warn = function(...args) {
              originalWarn.apply(console, args);
              addLog('warn', args);
            };
            console.error = function(...args) {
              originalError.apply(console, args);
              addLog('error', args);
            };
            console.info = function(...args) {
              originalInfo.apply(console, args);
              addLog('info', args);
            };
          }
          return window.__qaConsoleLogs || [];
        })()
      `);
      
      // Handle undefined or null logs
      if (!logs || !Array.isArray(logs)) {
        console.warn('Console logs evaluation returned invalid result:', typeof logs);
        return [];
      }
      
      return logs.map(log => ({
        level: log.level as 'log' | 'warn' | 'error' | 'info',
        message: log.message,
        timestamp: log.timestamp,
      }));
    } catch (error) {
      console.warn('Failed to capture console logs:', error);
      return [];
    }
  }

  async close(): Promise<void> {
    // Clean up CDP connections
    try {
      if (this.cdpSession) {
        await this.cdpSession.detach();
        this.cdpSession = null;
      }
      if (this.browser) {
        await this.browser.close();
        this.browser = null;
      }
      this.page = null;
    } catch (error) {
      console.warn('Error closing CDP connections:', error);
    }
    
    // Browserbase SDK completeSession method
    await this.client.completeSession(this.sessionId);
  }

  async switchToIframe(selector?: string): Promise<boolean> {
    try {
      await this.ensureCDPConnection();
      
      if (!this.page) {
        return false;
      }
      
      // If selector provided, try to find that iframe
      if (selector) {
        const iframe = await this.page.$(selector);
        if (iframe) {
          const frame = await iframe.contentFrame();
          if (frame) {
            // Switch context to iframe
            this.page = frame as any;
            return true;
          }
        }
      }
      
      // Otherwise, find the largest iframe (likely the game)
      const iframes = await this.page.$$('iframe');
      if (iframes.length === 0) {
        return false;
      }
      
      // Find the largest iframe
      let largestIframe = null;
      let maxArea = 0;
      
      for (const iframe of iframes) {
        const box = await iframe.boundingBox();
        if (box) {
          const area = box.width * box.height;
          if (area > maxArea && area > 400 * 400) { // Only consider substantial iframes
            maxArea = area;
            largestIframe = iframe;
          }
        }
      }
      
      if (largestIframe) {
        const frame = await largestIframe.contentFrame();
        if (frame) {
          // Switch context to iframe
          this.page = frame as any;
          return true;
        }
      }
      
      return false;
    } catch (error) {
      console.warn('Iframe switching failed:', error);
      return false;
    }
  }

  async switchToMainFrame(): Promise<void> {
    try {
      await this.ensureCDPConnection();
      
      // Reset to main page context
      if (this.browser) {
        const pages = await this.browser.pages();
        if (pages.length > 0) {
          this.page = pages[0];
        }
      }
    } catch (error) {
      console.warn('Switching to main frame failed:', error);
    }
  }

  async clickAt(x: number, y: number): Promise<boolean> {
    try {
      await this.ensureCDPConnection();
      
      // Use CDP to click at coordinates (most reliable for remote sessions)
      if (this.cdpSession) {
        try {
          // Send mouse move to coordinates
          await this.cdpSession.send('Input.dispatchMouseEvent', {
            type: 'mouseMoved',
            x: Math.round(x),
            y: Math.round(y),
          });
          
          await this.wait(50);
          
          // Send mouse pressed
          await this.cdpSession.send('Input.dispatchMouseEvent', {
            type: 'mousePressed',
            x: Math.round(x),
            y: Math.round(y),
            button: 'left',
            clickCount: 1,
          });
          
          await this.wait(50);
          
          // Send mouse released
          await this.cdpSession.send('Input.dispatchMouseEvent', {
            type: 'mouseReleased',
            x: Math.round(x),
            y: Math.round(y),
            button: 'left',
            clickCount: 1,
          });
          
          await this.wait(100);
          return true;
        } catch (cdpError) {
          console.warn('CDP clickAt failed, trying Playwright:', cdpError);
        }
      }
      
      // Fallback to Playwright
      if (this.page) {
        await this.page.mouse.click(x, y);
        await this.wait(100);
        return true;
      }
      
      return false;
    } catch (error) {
      console.warn(`clickAt failed at (${x}, ${y}):`, error);
      return false;
    }
  }
}

