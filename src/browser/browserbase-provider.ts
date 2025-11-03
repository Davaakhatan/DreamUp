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
      
      // Navigate using Playwright
      if (this.page) {
        await this.page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
        await this.wait(1000); // Additional wait for page to settle
      } else {
        // Fallback: try Browserbase SDK method
        await this.client.loadURL(url, { sessionId: this.sessionId });
        await this.wait(2000);
      }
    } catch (error) {
      console.warn('Navigation warning:', error instanceof Error ? error.message : String(error));
      // Continue anyway - page might still load
      await this.wait(2000);
    }
  }

  async screenshot(): Promise<Buffer> {
    try {
      // Ensure CDP connection
      await this.ensureCDPConnection();
      
      if (!this.cdpSession) {
        throw new Error('CDP session not available');
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
      
      if (this.page) {
        await this.page.click(selector, { timeout: 5000 });
        await this.wait(300); // Small delay after click
      } else {
        throw new Error('Page not available for click');
      }
    } catch (error) {
      console.warn(`Click failed on '${selector}':`, error instanceof Error ? error.message : String(error));
      await this.wait(500); // Delay anyway
    }
  }

  async keypress(key: string): Promise<void> {
    try {
      await this.ensureCDPConnection();
      
      if (this.page) {
        // Map common keys
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
        await this.page.keyboard.press(keyToPress);
        await this.wait(100);
      } else {
        throw new Error('Page not available for keypress');
      }
    } catch (error) {
      console.warn(`Keypress failed for '${key}':`, error instanceof Error ? error.message : String(error));
      await this.wait(100);
    }
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

  private getKeyCode(key: string): string {
    const keyMap: Record<string, string> = {
      ArrowUp: 'ArrowUp',
      ArrowDown: 'ArrowDown',
      ArrowLeft: 'ArrowLeft',
      ArrowRight: 'ArrowRight',
      Space: 'Space',
      Enter: 'Enter',
      Escape: 'Escape',
    };
    return keyMap[key] || key;
  }
}

