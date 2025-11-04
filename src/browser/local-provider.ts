/**
 * Local browser provider using Playwright (FREE - no API key needed)
 * This is a free alternative to Browserbase that runs browsers locally
 */

import { chromium, Browser, Page } from 'playwright-core';
import type { CDPSession } from 'playwright-core';
import type {
  BrowserProvider,
  BrowserSession,
  BrowserOptions,
  ConsoleLog,
} from '../types/browser.js';

export class LocalPlaywrightProvider implements BrowserProvider {
  async createSession(options: BrowserOptions = {}): Promise<BrowserSession> {
    try {
      console.log('🚀 Starting local browser (Playwright - FREE, no API key needed)...');
      
      // Launch Chromium browser locally
      // Check if SHOW_BROWSER env var is set to show browser window
      const showBrowser = process.env.SHOW_BROWSER === 'true' || options.headless === false;
      const browser = await chromium.launch({
        headless: !showBrowser, // Show browser if SHOW_BROWSER=true or headless=false
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          ...(showBrowser ? [] : ['--disable-accelerated-2d-canvas', '--disable-gpu']), // Only disable GPU if headless
          '--window-size=1280,720',
        ],
      });

      // Create a new page
      const context = await browser.newContext({
        viewport: {
          width: options.width || 1280,
          height: options.height || 720,
        },
      });

      const page = await context.newPage();
      
      // Set up console log capture
      const consoleLogs: ConsoleLog[] = [];
      page.on('console', (msg) => {
        const level = msg.type() as 'log' | 'warn' | 'error' | 'info';
        consoleLogs.push({
          level,
          message: msg.text(),
          timestamp: Date.now(),
        });
      });

      // Set up error capture
      page.on('pageerror', (error) => {
        consoleLogs.push({
          level: 'error',
          message: error.message,
          timestamp: Date.now(),
        });
      });

      // Connect to CDP for advanced features
      let cdpSession: CDPSession | null = null;
      try {
        const client = await context.newCDPSession(page);
        cdpSession = client;
      } catch (cdpError) {
        console.warn('CDP connection failed, continuing without advanced features:', cdpError);
      }

      console.log('✓ Local browser session created successfully');

      return new LocalPlaywrightSession(
        browser,
        page,
        context,
        cdpSession,
        consoleLogs,
        options
      );
    } catch (error) {
      console.error('Failed to create local browser session:', error);
      throw new Error(
        `Failed to create local browser session: ${error instanceof Error ? error.message : String(error)}\n` +
        `Make sure Chromium is installed. Run: npx playwright install chromium`
      );
    }
  }
}

class LocalPlaywrightSession implements BrowserSession {
  private currentUrl: string = 'about:blank';

  constructor(
    private browser: Browser,
    private page: Page,
    private context: any,
    private cdpSession: CDPSession | null,
    private consoleLogs: ConsoleLog[],
    private options: BrowserOptions
  ) {}

  get sessionId(): string {
    return 'local-playwright-session';
  }

  async navigate(url: string): Promise<void> {
    this.currentUrl = url;
    try {
      await this.page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 45000,
      });
      await this.wait(2000);
    } catch (error) {
      console.warn('Navigation warning:', error instanceof Error ? error.message : String(error));
      await this.wait(3000);
    }
  }

  async screenshot(): Promise<Buffer> {
    try {
      // Force repaint/reflow with timeout protection (simplified for speed)
      try {
        await Promise.race([
          this.page.evaluate(`
            (() => {
              void document.body.offsetHeight;
              return new Promise(resolve => {
                const animations = document.getAnimations();
                if (animations.length > 0) {
                  const maxDuration = Math.max(...Array.from(animations).map(a => {
                    const timing = a.effect?.getTiming();
                    return (timing?.duration || 0) * 1000;
                  }));
                  setTimeout(resolve, Math.min(maxDuration + 100, 500)); // Cap at 500ms max (reduced from 1s)
                } else {
                  setTimeout(resolve, 200); // Reduced from 300ms
                }
              });
            })()
          `),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Repaint timeout')), 1000)) // Reduced from 2s
        ]);
      } catch (e) {
        // Continue even if repaint times out - just do a minimal wait
        await this.wait(100); // Minimal wait
      }

      // Take screenshot with timeout (increased for reliability)
      const buffer = await Promise.race([
        this.page.screenshot({
          type: 'png',
          fullPage: false,
          timeout: 10000, // 10 second timeout (increased from 5s)
        }),
        new Promise<Buffer>((_, reject) => 
          setTimeout(() => reject(new Error('Screenshot timeout after 10s')), 10000)
        )
      ]);

      return buffer as Buffer;
    } catch (error) {
      console.error('Screenshot failed:', error);
      throw new Error(`Screenshot failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async click(selector: string): Promise<void> {
    try {
      await this.page.focus('body');
      await this.page.click(selector, { timeout: 5000 });
      await this.wait(200);
    } catch (error) {
      console.warn(`Click failed for selector "${selector}":`, error);
      await this.wait(100);
    }
  }

  async clickByText(text: string, options?: { exact?: boolean }): Promise<boolean> {
    try {
      const normalizedText = text.replace(/\s+/g, ' ').trim();
      await this.page.focus('body');
      
      // Try Playwright's getByText first
      const element = this.page.getByText(normalizedText, { exact: options?.exact || false });
      if (await element.isVisible({ timeout: 2000 }).catch(() => false)) {
        await element.click({ timeout: 5000 });
        await this.wait(200);
        return true;
      }
      
      // Fallback: XPath
      const xpath = `//*[contains(text(), ${JSON.stringify(normalizedText)})]`;
      const elements = await this.page.locator(`xpath=${xpath}`).all();
      for (const el of elements) {
        if (await el.isVisible({ timeout: 1000 }).catch(() => false)) {
          await el.click({ timeout: 5000 });
          await this.wait(200);
          return true;
        }
      }
      
      return false;
    } catch (error) {
      return false;
    }
  }

  async keypress(key: string): Promise<void> {
    try {
      await this.page.focus('body');
      await this.page.bringToFront();
      
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
    } catch (error) {
      console.warn(`Keypress failed for '${key}':`, error);
      await this.wait(100);
    }
  }

  async wait(ms: number): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, ms));
  }

  async evaluate(script: string): Promise<any> {
    return await this.page.evaluate(script);
  }

  async getConsoleLogs(): Promise<ConsoleLog[]> {
    return [...this.consoleLogs];
  }

  async close(): Promise<void> {
    try {
      if (this.cdpSession) {
        await this.cdpSession.detach().catch(() => {});
      }
      await this.context.close().catch(() => {});
      await this.browser.close().catch(() => {});
    } catch (error) {
      console.warn('Error closing local browser:', error);
    }
  }

  async switchToIframe(selector?: string): Promise<boolean> {
    try {
      if (selector) {
        const iframe = await this.page.$(selector);
        if (iframe) {
          const frame = await iframe.contentFrame();
          if (frame) {
            this.page = frame as any;
            return true;
          }
        }
      }
      
      const iframes = await this.page.$$('iframe');
      if (iframes.length === 0) return false;
      
      let largestIframe = null;
      let maxArea = 0;
      
      for (const iframe of iframes) {
        const box = await iframe.boundingBox();
        if (box) {
          const area = box.width * box.height;
          if (area > maxArea && area > 400 * 400) {
            maxArea = area;
            largestIframe = iframe;
          }
        }
      }
      
      if (largestIframe) {
        const frame = await largestIframe.contentFrame();
        if (frame) {
          this.page = frame as any;
          return true;
        }
      }
      
      return false;
    } catch (error) {
      return false;
    }
  }

  async switchToMainFrame(): Promise<void> {
    // For local Playwright, we can't easily switch back to main frame
    // This would require storing the original page reference
    // For now, just log a warning
    console.warn('switchToMainFrame not fully supported in local mode');
  }

  async clickAt(x: number, y: number): Promise<boolean> {
    try {
      await this.page.mouse.click(x, y);
      await this.wait(100);
      return true;
    } catch (error) {
      console.warn(`clickAt failed at (${x}, ${y}):`, error);
      return false;
    }
  }
}

