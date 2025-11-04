/**
 * Evidence capture system for screenshots and logs
 */

import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import type { BrowserSession } from '../types/browser.js';
import type { ScreenshotInfo } from '../types/report.js';
import type { ActionConfig } from '../types/config.js';

export class EvidenceCapture {
  private outputDir: string;
  private screenshots: ScreenshotInfo[] = [];
  private consoleLogs: string[] = [];

  constructor(outputDir: string = './output') {
    this.outputDir = outputDir;
  }

  /**
   * Initialize output directory
   */
  async initialize(): Promise<void> {
    await mkdir(this.outputDir, { recursive: true });
    await mkdir(join(this.outputDir, 'screenshots'), { recursive: true });
    await mkdir(join(this.outputDir, 'logs'), { recursive: true });
  }

  /**
   * Capture a screenshot
   */
  async captureScreenshot(
    session: BrowserSession,
    label?: string,
    checkForModals?: () => Promise<boolean>
  ): Promise<ScreenshotInfo> {
    // Check for and dismiss modals before taking screenshot if handler provided
    if (checkForModals) {
      try {
        console.log(`[Screenshot ${label}] Checking for modals before capture...`);
        const modalHandled = await checkForModals();
        if (modalHandled) {
          console.log(`[Screenshot ${label}] Modal dismissed, waiting for UI to settle...`);
          await session.wait(1000); // Wait longer for modal to close and UI to settle
        } else {
          console.warn(`[Screenshot ${label}] No modal found or modal could not be dismissed`);
        }
      } catch (error) {
        console.warn(`[Screenshot ${label}] Modal check failed:`, error);
      }
    }
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const labelSlug = label ? `-${label.replace(/\s+/g, '-')}` : '';
      const filename = `screenshot-${timestamp}${labelSlug}.png`;
      const filepath = join(this.outputDir, 'screenshots', filename);

      // CRITICAL: Wait for animations/transitions to complete before screenshot
      // This ensures tiles are fully rendered and visible
      await session.wait(300); // Small wait for any pending renders
      
      // Take screenshot with timeout protection (increased timeout for reliability)
      console.log(`📸 Capturing screenshot: ${label || 'unnamed'}`);
      let screenshotBuffer: Buffer;
      try {
        screenshotBuffer = await Promise.race([
          session.screenshot(),
          new Promise<Buffer>((_, reject) => 
            setTimeout(() => reject(new Error('Screenshot timeout after 15s')), 15000)
          )
        ]);
        console.log(`✓ Screenshot captured (${screenshotBuffer.length} bytes), saving...`);
      } catch (error) {
        // If screenshot fails, try a simpler approach without waiting for animations
        console.warn(`⚠ Screenshot failed, retrying with simpler method...`);
        try {
          await session.wait(500); // Short wait
          screenshotBuffer = await Promise.race([
            session.screenshot(),
            new Promise<Buffer>((_, reject) => 
              setTimeout(() => reject(new Error('Screenshot retry timeout after 10s')), 10000)
            )
          ]);
          console.log(`✓ Screenshot captured on retry (${screenshotBuffer.length} bytes)`);
        } catch (retryError) {
          console.error(`❌ Screenshot failed after retry:`, retryError);
          throw retryError;
        }
      }
      
      await writeFile(filepath, screenshotBuffer);
      console.log(`✓ Screenshot saved: ${filename}`);

      const screenshotInfo: ScreenshotInfo = {
        filename,
        timestamp: new Date().toISOString(),
        label,
      };

      this.screenshots.push(screenshotInfo);
      return screenshotInfo;
    } catch (error) {
      console.error('Failed to capture screenshot:', error);
      // Don't add failed screenshots to the array - they cause evaluation issues
      // Return empty info but don't push it
      return {
        filename: '',
        timestamp: new Date().toISOString(),
        label,
      };
    }
  }

  /**
   * Capture console logs
   */
  async captureConsoleLogs(session: BrowserSession): Promise<void> {
    try {
      const logs = await session.getConsoleLogs();
      this.consoleLogs = logs.map(
        (log) => `[${log.level}] ${log.message}`
      );
    } catch (error) {
      console.warn('Failed to capture console logs:', error);
      // Continue without logs (graceful degradation)
    }
  }

  /**
   * Get all captured screenshots (only valid ones with filenames)
   */
  getScreenshots(): ScreenshotInfo[] {
    // Filter out failed screenshots (empty filename)
    return this.screenshots.filter(s => s.filename && s.filename.length > 0);
  }

  /**
   * Get console errors
   */
  getConsoleErrors(): string[] {
    return this.consoleLogs.filter((log) => log.includes('[error]'));
  }

  /**
   * Get console warnings
   */
  getConsoleWarnings(): string[] {
    return this.consoleLogs.filter((log) => log.includes('[warn]'));
  }

  /**
   * Get all console logs
   */
  getAllConsoleLogs(): string[] {
    return [...this.consoleLogs];
  }

  /**
   * Save console logs to file
   */
  async saveConsoleLogs(gameUrl: string): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `console-${timestamp}.log`;
    const filepath = join(this.outputDir, 'logs', filename);

    const logContent = [
      `Game URL: ${gameUrl}`,
      `Timestamp: ${new Date().toISOString()}`,
      '',
      'Console Logs:',
      ...this.consoleLogs,
    ].join('\n');

    await writeFile(filepath, logContent);
    return filepath;
  }

  /**
   * Capture multiple screenshots based on action config
   */
  async captureActionScreenshots(
    session: BrowserSession,
    actions: ActionConfig[]
  ): Promise<void> {
    for (const action of actions) {
      if (action.type === 'screenshot') {
        await this.captureScreenshot(session, action.label);
        // Wait a bit between screenshots
        await session.wait(500);
      }
    }
  }
}

