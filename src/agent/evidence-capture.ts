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
    label?: string
  ): Promise<ScreenshotInfo> {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const labelSlug = label ? `-${label.replace(/\s+/g, '-')}` : '';
      const filename = `screenshot-${timestamp}${labelSlug}.png`;
      const filepath = join(this.outputDir, 'screenshots', filename);

      const screenshotBuffer = await session.screenshot();
      await writeFile(filepath, screenshotBuffer);

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

