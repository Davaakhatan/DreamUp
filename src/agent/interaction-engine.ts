/**
 * Interaction engine for executing game actions
 */

import type { BrowserSession } from '../types/browser.js';
import type { ActionConfig, TimeoutConfig } from '../types/config.js';

export class InteractionEngine {
  constructor(private session: BrowserSession, private timeouts: TimeoutConfig) {}

  /**
   * Execute a sequence of actions with timeout protection
   */
  async executeActions(actions: ActionConfig[]): Promise<void> {
    const startTime = Date.now();
    const totalTimeout = this.timeouts.total * 1000;

    for (const action of actions) {
      // Check total timeout
      if (Date.now() - startTime > totalTimeout) {
        throw new Error(`Total execution timeout exceeded (${this.timeouts.total}s)`);
      }

      await this.executeAction(action);
    }
  }

  /**
   * Execute a single action
   */
  private async executeAction(action: ActionConfig): Promise<void> {
    const actionTimeout = this.timeouts.action * 1000;
    const startTime = Date.now();

    try {
      switch (action.type) {
        case 'wait':
          const duration = (action.duration || 1) * 1000;
          await Promise.race([
            this.session.wait(duration),
            this.timeoutPromise(actionTimeout),
          ]);
          break;

        case 'click':
          if (!action.selector) {
            throw new Error('Click action requires a selector');
          }
          await Promise.race([
            this.session.click(action.selector),
            this.timeoutPromise(actionTimeout),
          ]);
          break;

        case 'keypress':
          if (!action.key) {
            throw new Error('Keypress action requires a key');
          }
          const repeat = action.repeat || 1;
          for (let i = 0; i < repeat; i++) {
            await Promise.race([
              this.session.keypress(action.key),
              this.timeoutPromise(actionTimeout),
            ]);
          }
          break;

        case 'screenshot':
          // Screenshots are handled by the evidence capture system
          // This action type is a no-op here, just wait a bit
          await this.session.wait(200);
          break;

        default:
          throw new Error(`Unknown action type: ${(action as any).type}`);
      }

      // Check if action took too long
      if (Date.now() - startTime > actionTimeout) {
        throw new Error(`Action timeout exceeded (${this.timeouts.action}s)`);
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('timeout')) {
        throw error;
      }
      // For other errors, log and continue (graceful degradation)
      console.warn(`Action ${action.type} failed:`, error);
    }
  }

  /**
   * Detect common UI patterns and attempt interaction
   */
  async detectAndInteract(): Promise<void> {
    // Try to find and click common start/play buttons
    // Use valid CSS selectors and XPath for text-based matching
    const commonSelectors = [
      'button.start',
      'button.play',
      '.start-button',
      '.play-button',
      '[data-action="start"]',
      '[data-action="play"]',
      '#start',
      '#play',
      'button[id*="start" i]',
      'button[id*="play" i]',
      'button[class*="start" i]',
      'button[class*="play" i]',
    ];

    // First try CSS selectors
    for (const selector of commonSelectors) {
      try {
        const exists = await this.session.evaluate(
          `document.querySelector('${selector}') !== null`
        ) as boolean;
        if (exists) {
          await this.session.click(selector);
          await this.session.wait(1000);
          return;
        }
      } catch (error) {
        // Continue trying other selectors
        continue;
      }
    }

    // Then try XPath for text-based matching (buttons containing "Start" or "Play")
    const textButtons = ['Start', 'Play', 'Begin', 'Go'];
    for (const text of textButtons) {
      try {
        const found = await this.session.evaluate(`
          (() => {
            const xpath = ".//button[contains(translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), '${text.toLowerCase()}')]";
            const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
            return result.singleNodeValue;
          })()
        `);
        
        if (found) {
          // Get the button element and click it
          const buttonSelector = await this.session.evaluate(`
            (() => {
              const xpath = ".//button[contains(translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), '${text.toLowerCase()}')]";
              const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
              const button = result.singleNodeValue;
              if (button) {
                // Try to find a unique selector for this button
                if (button.id) return '#' + button.id;
                if (button.className) return '.' + button.className.split(' ')[0];
                // Generate a unique attribute
                button.setAttribute('data-qa-found', 'true');
                return 'button[data-qa-found="true"]';
              }
              return null;
            })()
          `) as string | null;
          
          if (buttonSelector) {
            await this.session.click(buttonSelector);
            await this.session.wait(1000);
            return;
          }
        }
      } catch (error) {
        // Continue trying other text buttons
        continue;
      }
    }
  }

  private timeoutPromise(ms: number): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Action timeout')), ms);
    });
  }
}

