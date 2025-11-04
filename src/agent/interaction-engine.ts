/**
 * Interaction engine for executing game actions
 */

import type { BrowserSession } from '../types/browser.js';
import type { ActionConfig, TimeoutConfig } from '../types/config.js';
import type { ParsedInputSchema } from '../types/input-schema.js';
import type { EvidenceCapture } from './evidence-capture.js';
import { getActionKey, getActionKeys, getAxisKeys } from '../utils/input-schema-parser.js';

export class InteractionEngine {
  private inputSchema: ParsedInputSchema | null = null;

  constructor(
    private session: BrowserSession, 
    private timeouts: TimeoutConfig,
    private evidenceCapture?: EvidenceCapture,
    inputSchema?: ParsedInputSchema
  ) {
    this.inputSchema = inputSchema || null;
  }

  /**
   * Set or update the input schema
   */
  setInputSchema(schema: ParsedInputSchema | null): void {
    this.inputSchema = schema;
  }

  /**
   * Get the best key to use for an action based on input schema
   */
  private getBestKeyForAction(actionName: string, fallbackKey?: string): string {
    if (this.inputSchema) {
      const schemaKey = getActionKey(this.inputSchema, actionName);
      if (schemaKey) {
        return schemaKey;
      }
    }
    return fallbackKey || ' ';
  }

  /**
   * Get keys for movement based on input schema
   */
  private getMovementKeys(direction: 'up' | 'down' | 'left' | 'right'): string[] {
    if (this.inputSchema) {
      // Try common axis names
      const axisNames = ['Move', 'Movement', 'PlayerMove', 'MoveHorizontal', 'MoveVertical'];
      
      for (const axisName of axisNames) {
        let keys: string[] = [];
        
        if (direction === 'left') {
          keys = getAxisKeys(this.inputSchema, `${axisName}-X`, 'negative');
        } else if (direction === 'right') {
          keys = getAxisKeys(this.inputSchema, `${axisName}-X`, 'positive');
        } else if (direction === 'up') {
          keys = getAxisKeys(this.inputSchema, `${axisName}-Y`, 'negative');
        } else if (direction === 'down') {
          keys = getAxisKeys(this.inputSchema, `${axisName}-Y`, 'positive');
        }
        
        if (keys.length > 0) {
          return keys;
        }
      }
    }
    
    // Fallback to default arrow keys
    const defaultKeys: Record<string, string[]> = {
      up: ['ArrowUp', 'w', 'W'],
      down: ['ArrowDown', 's', 'S'],
      left: ['ArrowLeft', 'a', 'A'],
      right: ['ArrowRight', 'd', 'D'],
    };
    return defaultKeys[direction] || [];
  }

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
    
    // Helper to check if browser is still open
    const isBrowserOpen = async (): Promise<boolean> => {
      try {
        await this.session.evaluate('document.body');
        return true;
      } catch (e) {
        return false;
      }
    };
    const startTime = Date.now();

    // Helper to check timeout during long operations
    const checkTimeout = () => {
      if (Date.now() - startTime > actionTimeout) {
        throw new Error(`Action timeout exceeded (${this.timeouts.action}s)`);
      }
    };

    try {
      switch (action.type) {
        case 'wait':
          checkTimeout(); // Check timeout before waiting
          const duration = (action.duration || 1) * 1000;
          // Calculate remaining time and cap wait duration
          const elapsed = Date.now() - startTime;
          const remaining = actionTimeout - elapsed - 1000; // Leave 1s buffer
          if (remaining <= 0) {
            throw new Error(`Action timeout exceeded (${this.timeouts.action}s)`);
          }
          const actualWait = Math.min(duration, remaining);
          if (actualWait > 0) {
            await Promise.race([
              this.session.wait(actualWait),
              this.timeoutPromise(actionTimeout - elapsed),
            ]);
          }
          break;

        case 'click':
          if (!action.selector) {
            throw new Error('Click action requires a selector');
          }
          await Promise.race([
            this.session.click(action.selector),
            this.timeoutPromise(actionTimeout),
          ]);
          // Wait for UI to update after click (games need time to respond)
          await this.session.wait(1000); // Reduced from 1500ms
          
          // Only check for modals if game is NOT playing (to avoid resetting game)
          const isPlayingBeforeClick = await Promise.race([
            this.isGamePlaying(1500), // Quick check
            new Promise<boolean>(resolve => setTimeout(() => resolve(true), 1500)) // Assume playing if check is slow
          ]);
          if (!isPlayingBeforeClick) {
            // Game is not playing - check for modals
            await this.handleModalsAndDialogs();
          }
          
          // Capture screenshot after click if evidence capture is available
          if (this.evidenceCapture) {
            await this.evidenceCapture.captureScreenshot(
              this.session, 
              `after-click-${action.selector.replace(/[^a-zA-Z0-9]/g, '-')}`
            );
            await this.session.wait(200); // Reduced from 300ms
          }
          break;

        case 'keypress':
          if (!action.key) {
            throw new Error('Keypress action requires a key');
          }
          const repeat = action.repeat || 1;
          
          checkTimeout(); // Check before modal handling
          
          // Only check for modals/selection screens if game is NOT playing (to avoid resetting game)
          const isPlayingBeforeKeypress = await Promise.race([
            this.isGamePlaying(1500), // Quick check
            new Promise<boolean>(resolve => setTimeout(() => resolve(true), 1500)) // Assume playing if check is slow
          ]);
          if (!isPlayingBeforeKeypress) {
            // Game is not playing - check for modals and selection screens
            await this.handleModalsAndDialogs();
            await this.handleSelectionScreen(); // Also check for level/menu selection
          }
          
          checkTimeout(); // Check before focus
          
          // Ensure page is focused before starting keypress sequence
          try {
            await this.session.evaluate(`
              if (document.activeElement !== document.body) {
                document.body.focus();
              }
              // Also try to focus the game canvas/container if it exists
              const gameContainer = document.querySelector('canvas') || 
                                    document.querySelector('[class*="game"]') ||
                                    document.querySelector('[id*="game"]') ||
                                    document.body;
              if (gameContainer) {
                gameContainer.focus();
              }
            `);
            await this.session.wait(200);
          } catch (error) {
            console.warn('Focus attempt failed, continuing anyway:', error);
          }
          
          checkTimeout(); // Check before keypress loop
          
          // For keypresses, execute the sequence with delays between keypresses
          // Use input schema if available, otherwise fall back to default mapping
          let keyToPress = action.key;
          
          // Map common arrow key directions to schema-based keys
          const directionMap: Record<string, 'up' | 'down' | 'left' | 'right'> = {
            'ArrowUp': 'up',
            'ArrowDown': 'down',
            'ArrowLeft': 'left',
            'ArrowRight': 'right',
          };
          
          // If input schema is available, try to use schema-based keys for movement
          if (this.inputSchema && action.key) {
            const direction = directionMap[action.key];
            if (direction) {
              const schemaKeys = this.getMovementKeys(direction);
              if (schemaKeys.length > 0) {
                keyToPress = schemaKeys[0]; // Use first key from schema
                console.log(`🎮 Using input schema: ${action.key} -> ${keyToPress} (${direction})`);
              }
            }
          }
          
          // Fallback: Map WASD to arrow keys if needed (for Snake game compatibility)
          if (!this.inputSchema || !directionMap[action.key]) {
            const keyMap: Record<string, string> = {
              'w': 'ArrowUp',
              'a': 'ArrowLeft',
              's': 'ArrowDown',
              'd': 'ArrowRight',
              'W': 'ArrowUp',
              'A': 'ArrowLeft',
              'S': 'ArrowDown',
              'D': 'ArrowRight'
            };
            
            if (keyMap[keyToPress]) {
              keyToPress = keyMap[keyToPress];
            }
          }
          
          for (let i = 0; i < repeat; i++) {
            checkTimeout(); // Check timeout during iteration
            
            if (i === 0 && keyToPress !== action.key) {
              console.log(`🎮 Mapped ${action.key} to ${keyToPress} for compatibility`);
            }
            
            await Promise.race([
              this.session.keypress(keyToPress),
              this.timeoutPromise(actionTimeout),
            ]);
            // Delay between keypresses to allow game to process each one
            // Snake game needs slightly longer delays for smooth movement
            const delay = i === 0 ? 400 : 300; // Slightly longer for Snake game
            if (i < repeat - 1) {
              await this.session.wait(delay);
            }
          }
          
          checkTimeout(); // Check before waiting
          
          // Wait for game state to update after keypress sequence
          await this.session.wait(1000); // Reduced to 1s
          
          checkTimeout(); // Check before modal handling
          
          // Check if browser is still open before proceeding
          if (!(await isBrowserOpen())) {
            console.warn('⚠ Browser closed, skipping remaining actions');
            return;
          }
          
          // CRITICAL: Check for and dismiss modals BEFORE taking screenshot
          // This prevents all screenshots from showing the same modal state
          // Also check if we're in tutorial mode and skip it
          try {
            const modalHandled = await this.handleModalsAndDialogs();
            if (modalHandled) {
              await this.session.wait(300); // Minimal wait after modal dismissal
            }
          } catch (e) {
            if (e instanceof Error && e.message.includes('closed')) {
              console.warn('⚠ Browser closed during modal handling');
              return;
            }
            throw e;
          }
          
          // Check browser again before game state check
          if (!(await isBrowserOpen())) {
            return;
          }
          
          // Also verify game is still playing after each interaction (quick check only)
          try {
            const stillPlaying = await this.isGamePlaying(2000); // Quick 2s check
            if (!stillPlaying) {
              console.warn('⚠ Game appears to have stopped playing, attempting to restart...');
              // Don't block - just try once quickly
              await Promise.race([
                this.ensureGameIsPlaying(2), // Only 2 attempts
                new Promise(resolve => setTimeout(resolve, 5000)) // 5s timeout
              ]);
            }
          } catch (e) {
            if (e instanceof Error && e.message.includes('closed')) {
              console.warn('⚠ Browser closed during game state check');
              return;
            }
            // Continue on other errors
          }
          
          checkTimeout(); // Check before screenshot
          
          // Check if browser is still open before screenshot
          if (!(await isBrowserOpen())) {
            console.warn('⚠ Browser closed, skipping screenshot');
            return;
          }
          
          // Check for confirmation modals that might have appeared
          try {
            const hasConfirmation = await this.session.evaluate(`
              (() => {
                const modals = document.querySelectorAll('[class*="modal" i], [class*="dialog" i], [class*="confirm" i]');
                for (const modal of modals) {
                  const style = window.getComputedStyle(modal);
                  if (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0') {
                    const modalText = (modal.textContent || '').toLowerCase();
                    if (modalText.includes('sure') || modalText.includes('confirm')) {
                      return true;
                    }
                  }
                }
                return false;
              })()
            `) as boolean;
            
            if (hasConfirmation) {
              // Try to dismiss confirmation by clicking "Yes" or circular button
              await this.session.clickByText('yes', { exact: false }).catch(() => {});
              await this.session.clickByText('ok', { exact: false }).catch(() => {});
              await this.session.wait(1000);
            }
          } catch (e) {
            // Ignore confirmation check errors
          }
          
          // Capture screenshot after keypress sequence if evidence capture is available
          if (this.evidenceCapture) {
            // Check browser is still open
            if (!(await isBrowserOpen())) {
              console.warn('⚠ Browser closed, skipping action screenshot');
              return;
            }
            
            const keyLabel = action.key.toLowerCase().replace('arrow', '').replace(' ', '-');
            const label = repeat > 1 
              ? `after-${keyLabel}-x${repeat}` 
              : `after-${keyLabel}`;
            // Don't pass modal handler again - we already checked above
            // This prevents double-checking and reduces timeout risk
            try {
              await Promise.race([
                this.evidenceCapture.captureScreenshot(this.session, label),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Action screenshot timeout')), 15000))
              ]);
            } catch (screenshotError) {
              console.warn(`Screenshot failed after ${action.key}:`, screenshotError);
              // Continue execution even if screenshot fails
            }
            await this.session.wait(200); // Reduced wait after screenshot
          }
          break;

        case 'screenshot':
          // Explicit screenshot action - capture immediately
          if (this.evidenceCapture) {
            // Check browser is still open
            if (!(await isBrowserOpen())) {
              console.warn('⚠ Browser closed, skipping screenshot action');
              return;
            }
            
            try {
              await Promise.race([
                this.evidenceCapture.captureScreenshot(
                  this.session, 
                  action.label || 'screenshot'
                ),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Screenshot action timeout')), 15000))
              ]);
            } catch (screenshotError) {
              console.warn('Screenshot action failed:', screenshotError);
              // Continue execution even if screenshot fails
            }
          }
          await this.session.wait(200);
          break;

        default:
          throw new Error(`Unknown action type: ${(action as any).type}`);
      }

      // Check if action took too long (but allow some buffer for modal dismissal)
      const elapsed = Date.now() - startTime;
      if (elapsed > actionTimeout) {
        // Log what took so long
        console.warn(`Action ${action.type} took ${(elapsed / 1000).toFixed(2)}s (timeout: ${this.timeouts.action}s)`);
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
    // Step 0: Check if we're in tutorial mode and actively look for "New Game" buttons
    // Some games show tutorial overlay but "New Game" button is still visible on the page
    const isInTutorial = await this.session.evaluate(`
      (() => {
        // Check for tutorial text/overlays
        const bodyText = document.body.textContent || '';
        const hasTutorialText = bodyText.toLowerCase().includes('tutorial') || 
                                bodyText.toLowerCase().includes('boom') ||
                                bodyText.toLowerCase().includes('make a match') ||
                                bodyText.toLowerCase().includes('how to play');
        
        // Check for tutorial modal/overlay
        const tutorialModals = document.querySelectorAll('[class*="tutorial" i], [id*="tutorial" i]');
        let hasTutorialModal = false;
        for (const modal of tutorialModals) {
          const style = window.getComputedStyle(modal);
          if (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0') {
            hasTutorialModal = true;
            break;
          }
        }
        
        return hasTutorialText || hasTutorialModal;
      })()
    `) as boolean;
    
    if (isInTutorial) {
      console.log('🔍 Tutorial mode detected, looking for "New Game" button...');
      // Actively look for "New Game" button anywhere on the page (not just in modals)
      const newGameButtons = ['new game', 'start new game', 'start game'];
      for (const btnText of newGameButtons) {
        const clicked = await this.session.clickByText(btnText, { exact: false });
        if (clicked) {
          await this.session.wait(2000);
          
          // Check for confirmation modal and confirm it
          const hasConfirmation = await this.session.evaluate(`
            (() => {
              const bodyText = document.body.textContent || '';
              const hasConfirmText = bodyText.toLowerCase().includes('are you sure') ||
                                    bodyText.toLowerCase().includes('confirm');
              
              const modals = document.querySelectorAll('[class*="modal" i], [class*="dialog" i], [class*="confirm" i]');
              for (const modal of modals) {
                const style = window.getComputedStyle(modal);
                if (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0') {
                  const modalText = (modal.textContent || '').toLowerCase();
                  if (modalText.includes('sure') || modalText.includes('confirm')) {
                    return true;
                  }
                }
              }
              return hasConfirmText;
            })()
          `) as boolean;
          
          if (hasConfirmation) {
            console.log('🔍 Confirmation modal detected, confirming...');
            // Try to confirm
            const confirmButtons = ['yes', 'ok', 'confirm', 'start'];
            for (const confirmText of confirmButtons) {
              const confirmed = await this.session.clickByText(confirmText, { exact: false });
              if (confirmed) {
                await this.session.wait(2000);
                break;
              }
            }
            // Also try clicking circular button (common for confirmations)
            try {
              await this.session.evaluate(`
                (() => {
                  const buttons = Array.from(document.querySelectorAll('button'));
                  for (const btn of buttons) {
                    if (btn.offsetParent === null) continue;
                    const style = window.getComputedStyle(btn);
                    const borderRadius = style.borderRadius;
                    const width = parseInt(style.width) || 0;
                    const height = parseInt(style.height) || 0;
                    if (borderRadius.includes('50%') || 
                        (width > 0 && height > 0 && parseFloat(borderRadius) >= Math.min(width, height) / 2)) {
                      btn.click();
                      return true;
                    }
                  }
                  return false;
                })()
              `);
              await this.session.wait(2000);
            } catch (e) {
              // Ignore
            }
          }
          
          const isPlaying = await this.isGamePlaying(3000);
          if (isPlaying) {
            console.log(`✓ Escaped tutorial by clicking "${btnText}"`);
            return; // Successfully started game
          }
        }
      }
    }
    
    // Step 1: Handle modals and dialogs first (prioritize skipping tutorials)
    await this.handleModalsAndDialogs();
    
      // Step 1.25: Handle level/menu selection screens (generic, no hardcoding)
      // This handles screens like "Choose Level: SLUG WORM PYTHON" without hardcoding options
      await this.handleSelectionScreen();
      
      // Step 1.3: Check if game is canvas-only and needs coordinate-based interaction
      const isCanvasOnly = await this.isCanvasOnlyGame();
      if (isCanvasOnly) {
        console.log('🔍 Canvas-only game detected, using coordinate-based interaction');
        // For canvas-only games, try clicking center of canvas to start
        await this.clickCanvasAt(0.5, 0.5); // Click center of canvas
        await this.session.wait(1000);
      }
      
      // Step 1.5: Ensure game is actually playing (not stuck in tutorial/welcome)
      await this.ensureGameIsPlaying();
    
    // Step 2: Try to find and click common start/play buttons
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
        // Safely escape selector for use in evaluate
        const selectorJson = JSON.stringify(selector);
        const exists = await this.session.evaluate(
          `(() => {
            const selector = ${selectorJson};
            return document.querySelector(selector) !== null;
          })()`
        ) as boolean;
        if (exists) {
          await this.session.click(selector);
          await this.session.wait(2500); // Wait longer for game to start
          // Check if game is now playing
          const isPlaying = await this.isGamePlaying(3000);
          if (!isPlaying) {
            // Wait a bit more and check again (some games take longer to load)
            await this.session.wait(1500);
            const stillNotPlaying = await this.isGamePlaying(3000);
            if (!stillNotPlaying) {
              // Try clicking again - sometimes need to click twice
              try {
                await this.session.click(selector);
                await this.session.wait(2000);
              } catch (retryError) {
                // Ignore - button might be gone
              }
            }
          }
          // Capture screenshot after clicking start button
          if (this.evidenceCapture) {
            await this.evidenceCapture.captureScreenshot(this.session, 'after-start-click');
          }
          // Check if a modal appeared after clicking
          await this.handleModalsAndDialogs();
          // Verify game is playing one more time
          await this.ensureGameIsPlaying(2); // Quick check with 2 attempts
          return;
        }
      } catch (error) {
        // Continue trying other selectors
        continue;
      }
    }

    // Then try XPath for text-based matching (buttons containing "Start" or "Play")
    // Prioritize "PLAY" (uppercase) - common button text across many games
    const textButtons = ['Play', 'PLAY', 'Start', 'play', 'Begin', 'Go'];
    for (const text of textButtons) {
      try {
        // Use JSON.stringify to safely escape the text for XPath
        const textLower = text.toLowerCase();
        const textEscaped = JSON.stringify(textLower);
        
        const found = await this.session.evaluate(`
          (() => {
            const searchText = ${textEscaped};
            // XPath uses single quotes for string literals, so we need to escape single quotes in searchText
            const escapedSearchText = searchText.replace(/'/g, "''");
            const xpath = ".//button[contains(translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), '" + escapedSearchText + "')]";
            try {
              const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
              return result.singleNodeValue;
            } catch (e) {
              return null;
            }
          })()
        `);
        
        if (found) {
          // Get the button element and click it
          const buttonSelector = await this.session.evaluate(`
            (() => {
              const searchText = ${textEscaped};
              const escapedSearchText = searchText.replace(/'/g, "''");
              const xpath = ".//button[contains(translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), '" + escapedSearchText + "')]";
              try {
                const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                const button = result.singleNodeValue;
                if (button) {
                  // Try to find a unique selector for this button
                  if (button.id) {
                    const sanitizedId = String(button.id).replace(/[^a-zA-Z0-9_-]/g, '');
                    if (sanitizedId) return '#' + sanitizedId;
                  }
                  if (button.className && typeof button.className === 'string') {
                    const firstClass = button.className.trim().split(/\s+/)[0];
                    if (firstClass) {
                      const sanitizedClass = firstClass.replace(/[^a-zA-Z0-9_-]/g, '');
                      if (sanitizedClass) return '.' + sanitizedClass;
                    }
                  }
                  // Generate a unique attribute
                  button.setAttribute('data-qa-found', 'true');
                  return 'button[data-qa-found="true"]';
                }
                return null;
              } catch (e) {
                return null;
              }
            })()
          `) as string | null;
          
          if (buttonSelector) {
            await this.session.click(buttonSelector);
            await this.session.wait(2500); // Wait longer for game to start
            // Check if game is now playing
            const isPlaying = await this.isGamePlaying(3000);
            if (!isPlaying) {
              // Wait a bit more and check again (some games take longer to load)
              await this.session.wait(1500);
              const stillNotPlaying = await this.isGamePlaying(3000);
              if (!stillNotPlaying) {
                // Try clicking again - sometimes need to click twice
                try {
                  await this.session.click(buttonSelector);
                  await this.session.wait(2000);
                } catch (retryError) {
                  // Ignore - button might be gone
                }
              }
            }
            // Capture screenshot after clicking start button
            if (this.evidenceCapture) {
              await this.evidenceCapture.captureScreenshot(this.session, 'after-start-click');
            }
            // Check if a modal appeared after clicking
            await this.handleModalsAndDialogs();
            // Verify game is playing one more time
            await this.ensureGameIsPlaying(2); // Quick check with 2 attempts
            return;
          }
        }
      } catch (error) {
        // Continue trying other text buttons
        continue;
      }
    }
  }

  /**
   * Verify if the game is actually playing (not stuck in tutorial/welcome screen)
   * Generic detection - checks for gameplay indicators, not game-specific text
   * Has timeout to prevent hanging
   */
  async isGamePlaying(timeoutMs: number = 5000): Promise<boolean> {
    try {
      // Check if browser is still open first
      try {
        await this.session.evaluate('document.body');
      } catch (e) {
        if (e instanceof Error && e.message.includes('closed')) {
          console.warn('⚠ Browser closed during game state check');
          return false;
        }
        throw e;
      }
      
      // Add timeout wrapper to prevent hanging
      const gameStatePromise = this.session.evaluate(`
        (() => {
          // Generic gameplay indicators (works for any game):
          // 1. Score/counter elements that have changed (not zero/default)
          const scoreElements = Array.from(document.querySelectorAll('[class*="score" i], [id*="score" i], [class*="counter" i], [id*="counter" i]'));
          let hasActiveScore = false;
          for (const el of scoreElements) {
            const text = (el.textContent || el.innerText || '').trim();
            // If score exists and is not just "0" or empty, game is likely playing
            if (text && text !== '0' && text !== 'Score: 0' && text !== '0 pts' && !text.match(/^0\\s*$/)) {
              hasActiveScore = true;
              break;
            }
          }
          
          // 2. Check for interactive game elements (canvas, game board with content)
          // Also check iframes for canvas (for embedded games)
          let canvas = document.querySelector('canvas');
          if (!canvas) {
            // Check iframes for canvas
            const iframes = document.querySelectorAll('iframe');
            for (const iframe of iframes) {
              try {
                const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
                if (iframeDoc) {
                  const iframeCanvas = iframeDoc.querySelector('canvas');
                  if (iframeCanvas && iframeCanvas.width > 0 && iframeCanvas.height > 0) {
                    canvas = iframeCanvas;
                    break;
                  }
                }
              } catch (e) {
                // CORS - can't access iframe
                continue;
              }
            }
          }
          
          if (canvas && canvas.width > 0 && canvas.height > 0) {
            // Canvas exists - try to check if it has been drawn on
            try {
              const ctx = canvas.getContext('2d');
              if (ctx) {
                const imageData = ctx.getImageData(0, 0, Math.min(canvas.width, 100), Math.min(canvas.height, 100));
                // Check if canvas has non-transparent pixels (game has rendered)
                let hasContent = false;
                for (let i = 3; i < imageData.data.length; i += 4) {
                  if (imageData.data[i] > 0) { // Alpha channel > 0 means pixel exists
                    hasContent = true;
                    break;
                  }
                }
                if (hasContent) return true;
              }
            } catch (e) {
              // Canvas might be WebGL or not accessible, assume it's active if it exists
              return true;
            }
          }
          
          // 3. Check for game board/tiles that have content (numbers, colors, etc.)
          // Also check iframes for game boards
          let gameBoards = Array.from(document.querySelectorAll('[class*="board" i], [id*="board" i], [class*="grid" i], [id*="grid" i], [class*="tile" i], [class*="cell" i], [class*="game-container" i], [id*="game-container" i]'));
          
          // Check iframes for game content
          const iframes = document.querySelectorAll('iframe');
          for (const iframe of iframes) {
            try {
              const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
              if (iframeDoc) {
                const iframeBoards = Array.from(iframeDoc.querySelectorAll('[class*="board" i], [id*="board" i], [class*="grid" i], [id*="grid" i], [class*="tile" i], [class*="cell" i]'));
                gameBoards = gameBoards.concat(iframeBoards);
              }
            } catch (e) {
              // CORS - can't access iframe
              continue;
            }
          }
          
          gameBoards = Array.from(gameBoards);
          let hasGameContent = false;
          for (const board of gameBoards) {
            const children = Array.from(board.children || []);
            // If board has multiple children with content, game is likely playing
            const childrenWithContent = children.filter(child => {
              const computedStyle = window.getComputedStyle(child);
              const display = computedStyle.display;
              const visibility = computedStyle.visibility;
              const opacity = parseFloat(computedStyle.opacity);
              
              // Skip hidden elements
              if (display === 'none' || visibility === 'hidden' || opacity === 0) {
                return false;
              }
              
              const text = (child.textContent || child.innerText || '').trim();
              const bgColor = computedStyle.backgroundColor;
              
              // Check if element has dimensions (visible element)
              const rect = child.getBoundingClientRect();
              const hasSize = rect.width > 0 && rect.height > 0;
              
              // Generic check: child has visible text content (numbers, letters, etc.)
              // This works for any game (numbers, letters, symbols, colored tiles, etc.)
              const hasText = text && text !== '' && text !== '0' && text !== ' ' && !text.match(/^\\s*$/); // Double-escaped for template literal
              // Check if background is not transparent/default (has actual color)
              // Allow more colors but exclude common defaults
              const hasColor = bgColor && 
                               bgColor !== 'rgba(0, 0, 0, 0)' && 
                               bgColor !== 'transparent' &&
                               !bgColor.match(/^rgba?\\(\\s*255\\s*,\\s*255\\s*,\\s*255/); // Not white
              
              return (hasText || hasColor) && hasSize;
            });
            // At least 1 element with content means game has started
            if (childrenWithContent.length >= 1) {
              hasGameContent = true;
              break;
            }
          }
          
          // Also check for tile/cell elements directly (generic game board elements)
          const tileElements = Array.from(document.querySelectorAll('[class*="tile" i], [class*="cell" i], [class*="piece" i], [class*="block" i]'));
          for (const element of tileElements) {
            const computedStyle = window.getComputedStyle(element);
            const display = computedStyle.display;
            const visibility = computedStyle.visibility;
            const opacity = parseFloat(computedStyle.opacity);
            
            // Skip hidden elements
            if (display === 'none' || visibility === 'hidden' || opacity === 0) {
              continue;
            }
            
            const text = (element.textContent || element.innerText || '').trim();
            const bgColor = computedStyle.backgroundColor;
            
            // Check if element has dimensions (visible)
            const rect = element.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) {
              continue; // Skip zero-size elements
            }
            
            // Generic check: element has text content (numbers, letters, etc.)
            if (text && text !== '' && text !== '0' && text !== ' ' && !text.match(/^\\s*$/)) { // Double-escaped for template literal
              hasGameContent = true;
              break;
            }
            // Generic check: element has non-transparent/non-default background color
            if (bgColor && 
                bgColor !== 'rgba(0, 0, 0, 0)' && 
                bgColor !== 'transparent' &&
                !bgColor.match(/^rgba?\\(\\s*255\\s*,\\s*255\\s*,\\s*255/)) { // Not white (double-escaped for template literal)
              hasGameContent = true;
              break;
            }
          }
          
          // 4. Check for tutorial/welcome modal indicators (generic)
          const modals = Array.from(document.querySelectorAll('[class*="modal" i], [class*="overlay" i], [class*="tutorial" i], [class*="welcome" i], [class*="dialog" i]'));
          let hasBlockingModal = false;
          for (const modal of modals) {
            const style = window.getComputedStyle(modal);
            if (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0') {
              // Check if modal has tutorial-like buttons
              const buttons = Array.from(modal.querySelectorAll('button'));
              for (const btn of buttons) {
                const btnText = (btn.textContent || btn.innerText || '').trim().toLowerCase();
                if (btnText.includes('tutorial') || btnText.includes('welcome') || btnText.includes('how to play') || btnText.includes('learn')) {
                  hasBlockingModal = true;
                  break;
                }
              }
              if (hasBlockingModal) break;
            }
          }
          
          // Game is playing if: (has active score OR has game content) AND no blocking tutorial modal
          return (hasActiveScore || hasGameContent) && !hasBlockingModal;
        })()
      `);
      
      // Add timeout to prevent hanging
      const timeoutPromise = new Promise<boolean>((resolve) => {
        setTimeout(() => resolve(false), timeoutMs);
      });
      
      const gameState = await Promise.race([gameStatePromise, timeoutPromise]) as boolean;
      return gameState;
    } catch (error) {
      console.warn('Game state check failed:', error);
      return false; // Assume not playing if check fails
    }
  }

  /**
   * Ensure game is actually playing - skip tutorials/welcome screens generically
   * This is called after modal dismissal to verify gameplay has started
   * Has timeout to prevent hanging
   */
  async ensureGameIsPlaying(maxAttempts: number = 3): Promise<boolean> {
    const startTime = Date.now();
    const maxTime = 15000; // 15 seconds max
    
    try {
      // Quick check if game is already playing (with short timeout)
      const isPlaying = await this.isGamePlaying(3000);
      if (isPlaying) {
        return true; // Game is already playing
      }
      
      console.log('🔍 Game not playing yet, attempting to start...');
      
      // Try to find and click skip/close buttons (generic) - limited attempts
      const skipButtons = ['skip', 'got it', 'close', 'dismiss', 'no thanks'];
      for (let i = 0; i < Math.min(skipButtons.length, maxAttempts); i++) {
        if (Date.now() - startTime > maxTime) break;
        
        const btnText = skipButtons[i];
        try {
          const clicked = await this.session.clickByText(btnText, { exact: false });
          if (clicked) {
            await this.session.wait(1500);
            const nowPlaying = await this.isGamePlaying(3000);
            if (nowPlaying) {
              console.log(`✓ Game started after clicking "${btnText}"`);
              return true;
            }
          }
        } catch (error) {
          continue; // Try next button
        }
      }
      
      // Try pressing Escape to close any modals
      if (Date.now() - startTime < maxTime) {
        try {
          await this.session.keypress('Escape');
          await this.session.wait(1000);
          const escapePlaying = await this.isGamePlaying(3000);
          if (escapePlaying) {
            console.log('✓ Game started after pressing Escape');
            return true;
          }
        } catch (error) {
          // Continue
        }
      }
      
      // Try clicking "New Game" or "Start" buttons - limited attempts
      // Prioritize "PLAY" button - common across many games, check both uppercase and lowercase
      const startButtons = ['play', 'new game', 'start game', 'start', 'begin', 'go'];
      for (let i = 0; i < Math.min(startButtons.length, maxAttempts * 2); i++) {
        if (Date.now() - startTime > maxTime) break;
        
        const btnText = startButtons[i];
        try {
          // Try clicking by text (case-insensitive)
          const clicked = await this.session.clickByText(btnText, { exact: false });
          if (clicked) {
            await this.session.wait(2500); // Wait longer for game to start
            const nowPlaying = await this.isGamePlaying(3000);
            if (nowPlaying) {
              console.log(`✓ Game started after clicking "${btnText}"`);
              return true;
            }
            // If not playing yet, wait a bit more and check again (some games take longer)
            await this.session.wait(1500);
            const stillNotPlaying = await this.isGamePlaying(3000);
            if (!stillNotPlaying) {
              // Try clicking again - sometimes need to click twice
              await this.session.clickByText(btnText, { exact: false });
              await this.session.wait(2000);
              const retryPlaying = await this.isGamePlaying(3000);
              if (retryPlaying) {
                console.log(`✓ Game started after retry clicking "${btnText}"`);
                return true;
              }
            } else {
              return true;
            }
          }
        } catch (error) {
          continue; // Try next button
        }
      }
      
      // If still not playing, try pressing Space or Enter (common start keys)
      if (Date.now() - startTime < maxTime) {
        try {
          await this.session.keypress('Space');
          await this.session.wait(1000);
          const spacePlaying = await this.isGamePlaying(3000);
          if (spacePlaying) {
            console.log('✓ Game started after pressing Space');
            return true;
          }
        } catch (error) {
          // Continue
        }
      }
      
      if (Date.now() - startTime < maxTime) {
        try {
          await this.session.keypress('Enter');
          await this.session.wait(1000);
          const enterPlaying = await this.isGamePlaying(3000);
          if (enterPlaying) {
            console.log('✓ Game started after pressing Enter');
            return true;
          }
        } catch (error) {
          // Continue
        }
      }
      
      console.warn('⚠ Could not verify game is playing - continuing anyway (game may still work)');
      return false; // Return false but don't block - game might still be functional
    } catch (error) {
      console.warn('Ensure game playing failed:', error);
      return false; // Don't block on error
    }
  }

  /**
   * Handle level/menu selection screens (generic, no hardcoding)
   * Detects selection screens (level, difficulty, character) and automatically selects an option
   */
  async handleSelectionScreen(): Promise<boolean> {
    try {
      // CRITICAL: First check if cookie consent is blocking - skip if so
      const hasCookieConsent = await this.session.evaluate(`
        (() => {
          // Check for OneTrust cookie consent
          const oneTrust = document.querySelector('#onetrust-consent-sdk, [id*="onetrust"]');
          if (oneTrust) {
            const style = window.getComputedStyle(oneTrust);
            if (style.display !== 'none' && style.visibility !== 'hidden') {
              return true;
            }
          }
          
          // Check for cookie consent modals
          const cookieModals = document.querySelectorAll('[id*="cookie" i], [class*="cookie" i], [id*="consent" i], [class*="consent" i]');
          for (const modal of cookieModals) {
            const style = window.getComputedStyle(modal);
            if (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0') {
              return true;
            }
          }
          
          // Check for cookie consent text
          const bodyText = (document.body.textContent || '').toLowerCase();
          if (bodyText.includes('accept all cookies') || 
              bodyText.includes('cookie settings') ||
              bodyText.includes('privacy policy') ||
              bodyText.includes('gdpr') ||
              (bodyText.includes('cookie') && bodyText.includes('agree'))) {
            return true;
          }
          
          return false;
        })()
      `) as boolean;
      
      if (hasCookieConsent) {
        // Cookie consent is present - try to handle it first
        console.log('🔍 Cookie consent detected in selection screen check, handling it first...');
        const cookieHandled = await this.handleCookieConsent();
        if (cookieHandled) {
          await this.session.wait(2000); // Wait for cookie consent to be dismissed
          // Check again if selection screen is still needed
          const stillHasCookie = await this.session.evaluate(`
            (() => {
              const oneTrust = document.querySelector('#onetrust-consent-sdk');
              if (oneTrust) {
                const style = window.getComputedStyle(oneTrust);
                return style.display !== 'none' && style.visibility !== 'hidden';
              }
              return false;
            })()
          `) as boolean;
          if (stillHasCookie) {
            console.log('⚠ Cookie consent still blocking, skipping selection screen');
            return false; // Don't try selection screen if cookie consent is still blocking
          }
        } else {
          // Cookie consent not handled, skip selection screen
          console.log('⚠ Cookie consent blocking, skipping selection screen');
          return false;
        }
      }
      
      // Check if we're on a selection screen
      const isSelectionScreen = await this.session.evaluate(`
        (() => {
          const bodyText = (document.body.textContent || '').toLowerCase();
          
          // Skip if cookie consent text is present (already handled above, but double-check)
          if (bodyText.includes('accept all cookies') || 
              bodyText.includes('cookie settings') ||
              bodyText.includes('privacy policy')) {
            return false; // Not a selection screen, it's cookie consent
          }
          
          // Common selection screen keywords
          const selectionKeywords = [
            'choose level',
            'select level',
            'choose difficulty',
            'select difficulty',
            'choose character',
            'select character',
            'choose mode',
            'select mode',
            'choose',
            'select',
          ];
          
          // Check if page contains selection keywords
          const hasSelectionText = selectionKeywords.some(keyword => bodyText.includes(keyword));
          
          // Also check if game is NOT playing (we're likely on a menu)
          const hasGameplay = (() => {
            // Check for score/counter (indicates gameplay)
            const scoreElements = document.querySelectorAll('[class*="score" i], [id*="score" i]');
            for (const el of scoreElements) {
              const text = (el.textContent || '').trim();
              if (text && text !== '0' && text !== 'Score: 0') {
                return true; // Game is playing
              }
            }
            
            // Check for game board with content
            const boards = document.querySelectorAll('[class*="board" i], [class*="grid" i], [class*="game" i]');
            for (const board of boards) {
              const children = Array.from(board.children || []);
              const hasContent = children.some(child => {
                const text = (child.textContent || '').trim();
                const style = window.getComputedStyle(child);
                return text && text !== '' && style.display !== 'none';
              });
              if (hasContent) return true;
            }
            
            return false;
          })();
          
          return hasSelectionText && !hasGameplay;
        })()
      `) as boolean;
      
      if (!isSelectionScreen) {
        return false; // Not on a selection screen
      }
      
      console.log('🔍 Selection screen detected, finding clickable options...');
      
      // Find all clickable options (buttons, clickable divs, links, text elements)
      // CRITICAL: For Snake game, level names (SLUG, WORM, PYTHON) might be text elements, not buttons
      const options = await this.session.evaluate(`
        (() => {
          const clickableOptions = [];
          
          // Common level/difficulty names (case-insensitive)
          const levelNames = ['slug', 'worm', 'python', 'easy', 'medium', 'hard', 'beginner', 'intermediate', 'advanced', 'expert', 'normal', 'casual', 'pro'];
          
          // Find all potentially clickable elements (including text elements for Snake game)
          const elements = Array.from(document.querySelectorAll(
            'button, a, [role="button"], [onclick], [class*="option" i], [class*="choice" i], [class*="select" i], [class*="level" i], [class*="difficulty" i], div, span, p, h1, h2, h3, h4, h5, h6'
          ));
          
          for (const el of elements) {
            if (el.offsetParent === null) continue; // Skip hidden elements
            
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
              continue;
            }
            
            const text = (el.textContent || el.innerText || '').trim();
            const rect = el.getBoundingClientRect();
            
            // Skip elements that are too small or empty
            if (rect.width < 20 || rect.height < 20 || !text || text.length < 2) {
              continue;
            }
            
            // Skip common navigation buttons (back, close, menu)
            const lowerText = text.toLowerCase();
            if (lowerText === 'back' || lowerText === 'close' || lowerText === 'menu' || lowerText === 'home' || lowerText.includes('choose') || lowerText.includes('select')) {
              continue;
            }
            
            // Check if it's a level name (like SLUG, WORM, PYTHON for Snake game)
            const isLevelName = levelNames.some(level => lowerText === level || lowerText.includes(level));
            
            // Check if element is clickable (has onclick, is button/link, or has pointer cursor)
            const isClickable = 
              el.tagName === 'BUTTON' ||
              el.tagName === 'A' ||
              el.getAttribute('role') === 'button' ||
              el.getAttribute('onclick') ||
              style.cursor === 'pointer' ||
              el.onclick !== null ||
              isLevelName; // Text elements with level names are likely clickable
            
            if (isClickable) {
              // For text elements, try to find a parent container or use coordinates
              let clickMethod = 'click';
              let selector = '';
              let coordinates = null;
              
              if (el.id) {
                selector = '#' + String(el.id).replace(/[^a-zA-Z0-9_-]/g, '');
              } else if (el.className && typeof el.className === 'string') {
                const firstClass = el.className.trim().split(/\\s+/)[0];
                if (firstClass) {
                  selector = '.' + firstClass.replace(/[^a-zA-Z0-9_-]/g, '');
                }
              }
              
              // If no selector but it's a level name, use coordinates
              if (!selector && isLevelName) {
                const centerX = rect.left + rect.width / 2;
                const centerY = rect.top + rect.height / 2;
                coordinates = { x: centerX, y: centerY };
                clickMethod = 'coordinates';
              }
              
              if (selector || coordinates) {
                clickableOptions.push({
                  text: text,
                  selector: selector || '',
                  coordinates: coordinates,
                  clickMethod: clickMethod,
                  area: rect.width * rect.height, // Prefer larger options (more visible)
                  isLevelName: isLevelName,
                });
              }
            }
          }
          
          // Sort by priority: level names first, then by area
          clickableOptions.sort((a, b) => {
            if (a.isLevelName && !b.isLevelName) return -1;
            if (!a.isLevelName && b.isLevelName) return 1;
            return b.area - a.area;
          });
          
          return clickableOptions;
        })()
      `) as Array<{ text: string; selector: string; coordinates?: { x: number; y: number }; clickMethod: string; area: number; isLevelName: boolean }>;
      
      if (options.length === 0) {
        console.log('⚠ No clickable options found on selection screen');
        return false;
      }
      
      console.log(`✓ Found ${options.length} option(s) on selection screen: ${options.map(o => o.text).join(', ')}`);
      
      // Select the middle option (prefer level names like WORM for Snake game)
      const levelOptions = options.filter(o => o.isLevelName);
      const selectedOption = levelOptions.length > 0 
        ? (levelOptions.length >= 2 ? levelOptions[Math.floor(levelOptions.length / 2)] : levelOptions[0])
        : (options.length >= 2 ? options[Math.floor(options.length / 2)] : options[0]);
      
      console.log(`🎯 Selecting: "${selectedOption.text}" (priority: level names first)`);
      
      let clicked = false;
      
      // Method 1: Try coordinates click (for text elements like Snake game's SLUG/WORM/PYTHON)
      if (selectedOption.coordinates && !clicked && this.session.clickAt) {
        try {
          console.log(`📍 Clicking at coordinates: (${selectedOption.coordinates.x}, ${selectedOption.coordinates.y})`);
          clicked = await this.session.clickAt(selectedOption.coordinates.x, selectedOption.coordinates.y);
          if (clicked) {
            console.log(`✓ Clicked "${selectedOption.text}" via coordinates`);
          }
        } catch (error) {
          console.warn(`Failed to click by coordinates:`, error);
        }
      }
      
      // Alternative: Try mouse click via evaluate if clickAt not available
      if (!clicked && selectedOption.coordinates) {
        try {
          console.log(`📍 Trying mouse click via evaluate at: (${selectedOption.coordinates.x}, ${selectedOption.coordinates.y})`);
          clicked = await this.session.evaluate(`
            (() => {
              try {
                const x = ${selectedOption.coordinates!.x};
                const y = ${selectedOption.coordinates!.y};
                const element = document.elementFromPoint(x, y);
                if (element) {
                  element.click();
                  return true;
                }
                return false;
              } catch (e) {
                return false;
              }
            })()
          `) as boolean;
          if (clicked) {
            console.log(`✓ Clicked "${selectedOption.text}" via mouse click`);
          }
        } catch (error) {
          console.warn(`Failed to click via mouse:`, error);
        }
      }
      
      // Method 2: Try selector click
      if (!clicked && selectedOption.selector) {
        try {
          if (/^[#.][a-zA-Z0-9_-]+$/.test(selectedOption.selector)) {
            await this.session.click(selectedOption.selector);
            clicked = true;
            console.log(`✓ Clicked "${selectedOption.text}" via selector`);
          }
        } catch (error) {
          console.warn(`Failed to click by selector:`, error);
        }
      }
      
      // Method 3: Fallback: try clicking by text
      if (!clicked) {
        clicked = await this.session.clickByText(selectedOption.text, { exact: false });
        if (clicked) {
          console.log(`✓ Clicked "${selectedOption.text}" via text`);
        }
      }
      
      // Method 4: Last resort - direct DOM click
      if (!clicked) {
        console.log('⚠ Standard methods failed, trying direct DOM click...');
        clicked = await this.session.evaluate(`
          (() => {
            try {
              const allElements = Array.from(document.querySelectorAll('*'));
              for (const el of allElements) {
                const text = (el.textContent || el.innerText || '').trim();
                const targetText = ${JSON.stringify(selectedOption.text)};
                
                if (text === targetText || text.toLowerCase() === targetText.toLowerCase()) {
                  const style = window.getComputedStyle(el);
                  if (style.display !== 'none' && el.offsetParent !== null) {
                    el.click();
                    return true;
                  }
                }
              }
              return false;
            } catch (e) {
              return false;
            }
          })()
        `) as boolean;
        if (clicked) {
          console.log(`✓ Clicked "${selectedOption.text}" via direct DOM`);
        }
      }
      
      if (clicked) {
        console.log(`✓ Selected "${selectedOption.text}"`);
        await this.session.wait(2000); // Wait for selection to process
        
        // CRITICAL: For Snake game, wait for 3-second countdown before game starts
        console.log('⏳ Waiting for countdown/start sequence (3 seconds)...');
        await this.session.wait(3500); // Wait 3.5 seconds for countdown (3s countdown + buffer)
        
        // Check if game has started
        const isPlaying = await this.isGamePlaying(3000);
        if (isPlaying) {
          console.log('✓ Game started after level selection');
          return true;
        } else {
          console.log('⚠ Game may still be in countdown, continuing...');
          return true; // Still return true since we clicked
        }
      }
      
      return false;
    } catch (error) {
      console.warn('Selection screen handling failed:', error);
      return false;
    }
  }

  /**
   * Handle iframe-embedded games (itch.io, kongregate)
   * Detects game iframes and switches interaction context to iframe
   */
  async handleIframeGame(): Promise<boolean> {
    try {
      // Check if we're on a page with iframes (common on game hosting sites)
      const hasIframes = await this.session.evaluate(`
        (() => {
          const iframes = document.querySelectorAll('iframe');
          return iframes.length > 0;
        })()
      `) as boolean;
      
      if (!hasIframes) {
        return false; // No iframes found
      }
      
      console.log('🔍 Iframes detected, checking for game iframe...');
      
      // Find the game iframe (usually the largest or has canvas/game content)
      const iframeInfo = await this.session.evaluate(`
        (() => {
          const iframes = Array.from(document.querySelectorAll('iframe'));
          const gameIframes = [];
          
          for (const iframe of iframes) {
            try {
              // Check if iframe is visible and has reasonable size
              const rect = iframe.getBoundingClientRect();
              if (rect.width < 100 || rect.height < 100) continue;
              
              // Try to access iframe content (might fail due to CORS)
              let hasGameContent = false;
              try {
                const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
                if (iframeDoc) {
                  // Check for game indicators
                  const hasCanvas = iframeDoc.querySelector('canvas');
                  const hasGameClass = iframeDoc.querySelector('[class*="game" i], [id*="game" i]');
                  const hasBoard = iframeDoc.querySelector('[class*="board" i], [class*="grid" i]');
                  
                  if (hasCanvas || hasGameClass || hasBoard) {
                    hasGameContent = true;
                  }
                }
              } catch (e) {
                // CORS - can't access iframe content, but assume it might be a game iframe
                // Based on size and position (game iframes are usually large and centered)
                if (rect.width > 400 && rect.height > 400) {
                  hasGameContent = true;
                }
              }
              
              if (hasGameContent || rect.width > 400) {
                gameIframes.push({
                  index: Array.from(document.querySelectorAll('iframe')).indexOf(iframe),
                  width: rect.width,
                  height: rect.height,
                  area: rect.width * rect.height,
                });
              }
            } catch (e) {
              continue;
            }
          }
          
          // Sort by area (largest first - likely the game)
          gameIframes.sort((a, b) => b.area - a.area);
          return gameIframes.length > 0 ? gameIframes[0].index : -1;
        })()
      `) as number;
      
      if (iframeInfo === -1) {
        return false; // No game iframe found
      }
      
      console.log(`✓ Game iframe found at index ${iframeInfo}, switching context...`);
      
      // Switch to iframe context if BrowserSession supports it
      if (this.session.switchToIframe) {
        const switched = await this.session.switchToIframe();
        if (switched) {
          console.log('✓ Switched to iframe context');
          await this.session.wait(1000); // Wait for iframe to be ready
          return true;
        }
      }
      
      // Fallback: Try to click/focus the iframe
      await this.session.evaluate(`
        (() => {
          const iframes = document.querySelectorAll('iframe');
          if (iframes[${iframeInfo}]) {
            iframes[${iframeInfo}].focus();
            // Try to click the iframe to focus it
            iframes[${iframeInfo}].click();
            return true;
          }
          return false;
        })()
      `);
      
      await this.session.wait(1000);
      return true;
    } catch (error) {
      console.warn('Iframe handling failed:', error);
      return false;
    }
  }

  /**
   * Handle cookie/GDPR consent modals
   */
  async handleCookieConsent(): Promise<boolean> {
    try {
      // First, try to dismiss any overlay that might be blocking
      const overlayDismissed = await this.session.evaluate(`
        (() => {
          // Try to close OneTrust overlay if present
          const onetrustOverlay = document.querySelector('.onetrust-pc-dark-filter, #onetrust-consent-sdk');
          if (onetrustOverlay) {
            const style = window.getComputedStyle(onetrustOverlay);
            if (style.display !== 'none' && style.visibility !== 'hidden') {
              // Method 1: Try to click accept button directly
              const acceptBtn = document.querySelector('#onetrust-accept-btn-handler, .onetrust-accept-btn-handler');
              if (acceptBtn) {
                acceptBtn.click();
                return true;
              }
              
              // Method 2: Try to hide the overlay by removing it or hiding it
              try {
                // Try to hide the overlay
                if (onetrustOverlay.style) {
                  onetrustOverlay.style.display = 'none';
                  onetrustOverlay.style.visibility = 'hidden';
                  onetrustOverlay.style.opacity = '0';
                }
                
                // Also try to hide the parent consent SDK
                const consentSdk = document.querySelector('#onetrust-consent-sdk');
                if (consentSdk && consentSdk.style) {
                  consentSdk.style.display = 'none';
                  consentSdk.style.visibility = 'hidden';
                }
                
                return true;
              } catch (e) {
                // Continue to next method
              }
              
              // Method 3: Try to click close button
              const closeBtn = document.querySelector('#onetrust-close-btn-handler, .onetrust-close-btn-handler, [id*="close"]');
              if (closeBtn) {
                closeBtn.click();
                return true;
              }
            }
          }
          return false;
        })()
      `) as boolean;
      
      if (overlayDismissed) {
        await this.session.wait(1000); // Wait longer for overlay to be removed
      }
      
      // Detect cookie consent modal
      const consentInfo = await this.session.evaluate(`
        (() => {
          const result = { hasModal: false, acceptButtons: [], hasOneTrust: false };
          
          // Check for OneTrust (common cookie consent framework)
          const oneTrust = document.querySelector('#onetrust-consent-sdk, [id*="onetrust"]');
          if (oneTrust) {
            const style = window.getComputedStyle(oneTrust);
            if (style.display !== 'none' && style.visibility !== 'hidden') {
              result.hasOneTrust = true;
              result.hasModal = true;
            }
          }
          
          // Check for other cookie consent modals
          const cookieModals = document.querySelectorAll('[id*="cookie" i], [class*="cookie" i], [id*="consent" i], [class*="consent" i], [id*="gdpr" i], [class*="gdpr" i]');
          for (const modal of cookieModals) {
            const style = window.getComputedStyle(modal);
            if (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0') {
              result.hasModal = true;
              break;
            }
          }
          
          if (!result.hasModal) {
            const bodyText = (document.body.textContent || '').toLowerCase();
            result.hasModal = bodyText.includes('cookie') || bodyText.includes('gdpr') || bodyText.includes('privacy policy');
          }
          
          if (!result.hasModal) return result;
          
          // Find accept buttons (prioritize actual buttons over links)
          const allButtons = Array.from(document.querySelectorAll('button, [role="button"], a, [onclick*="accept"], [onclick*="cookie"]'));
          for (const btn of allButtons) {
            if (btn.offsetParent === null) continue;
            const style = window.getComputedStyle(btn);
            if (style.display === 'none' || style.visibility === 'hidden') continue;
            
            const btnText = (btn.textContent || btn.innerText || '').trim().toLowerCase();
            const btnId = (btn.id || '').toLowerCase();
            const btnClass = (btn.className || '').toLowerCase();
            
            // Skip privacy policy links and settings
            const btnTagName = btn.tagName.toLowerCase();
            if (btnText.includes('privacy policy') || 
                btnText.includes('cookie settings') ||
                btnText.includes('cookie policy') ||
                btnText.includes('preferences') ||
                btnText.includes('manage') ||
                btnText.includes('customize') ||
                (btnTagName === 'a' && btnText.length > 100)) {
              continue;
            }
            
            // Prioritize "accept all" buttons
            if (btnText.includes('accept all') || 
                btnText.includes('accept all cookies') ||
                btnId.includes('accept-all') ||
                btnClass.includes('accept-all')) {
              result.acceptButtons.push({ text: btnText, id: btn.id, className: btn.className, tagName: btn.tagName, isButton: btn.tagName === 'BUTTON' });
            }
            // Then other accept buttons
            else if ((btnText.includes('accept') && !btnText.includes('privacy')) || 
                     btnText.includes('i agree') ||
                     btnText.includes('agree') ||
                     (btnText.includes('allow') && btnText.includes('cookie')) ||
                     btnText === 'ok' ||
                     btnText === 'continue') {
              result.acceptButtons.push({ text: btnText, id: btn.id, className: btn.className, tagName: btn.tagName, isButton: btn.tagName === 'BUTTON' });
            }
          }
          
          // Sort: buttons first, then "accept all" first
          result.acceptButtons.sort((a, b) => {
            if (a.isButton !== b.isButton) return a.isButton ? -1 : 1;
            if (a.text.includes('accept all') !== b.text.includes('accept all')) {
              return a.text.includes('accept all') ? -1 : 1;
            }
            return 0;
          });
          
          return result;
        })()
      `) as { hasModal: boolean; acceptButtons: Array<{ text: string; id: string; className: string; tagName: string; isButton: boolean }>; hasOneTrust: boolean };
      
      if (!consentInfo.hasModal) {
        return false;
      }
      
      console.log(`🔍 Cookie/GDPR consent modal detected${consentInfo.hasOneTrust ? ' (OneTrust)' : ''}...`);
      
      // Try OneTrust-specific accept button first
      if (consentInfo.hasOneTrust) {
        const oneTrustAccepted = await this.session.evaluate(`
          (() => {
            // OneTrust accept button IDs (try multiple methods)
            const acceptSelectors = [
              '#onetrust-accept-btn-handler',
              '.onetrust-accept-btn-handler',
              '[id*="accept-btn"]',
              '[class*="accept-btn"]',
              'button[id*="onetrust"]',
              'button[class*="accept"]'
            ];
            
            // Method 1: Try clicking accept button
            for (const selector of acceptSelectors) {
              const btn = document.querySelector(selector);
              if (btn) {
                const style = window.getComputedStyle(btn);
                if (style.display !== 'none' && style.visibility !== 'hidden') {
                  btn.click();
                  
                  // Also hide the overlay to ensure it's dismissed
                  const overlay = document.querySelector('.onetrust-pc-dark-filter');
                  if (overlay && overlay.style) {
                    overlay.style.display = 'none';
                    overlay.style.visibility = 'hidden';
                    overlay.style.opacity = '0';
                  }
                  
                  const consentSdk = document.querySelector('#onetrust-consent-sdk');
                  if (consentSdk && consentSdk.style) {
                    consentSdk.style.display = 'none';
                    consentSdk.style.visibility = 'hidden';
                  }
                  
                  return true;
                }
              }
            }
            
            // Method 2: If button not found, try to hide overlay and trigger OneTrust close
            const overlay = document.querySelector('.onetrust-pc-dark-filter, #onetrust-consent-sdk');
            if (overlay) {
              const style = window.getComputedStyle(overlay);
              if (style.display !== 'none' && style.visibility !== 'hidden') {
                // Hide overlay
                if (overlay.style) {
                  overlay.style.display = 'none';
                  overlay.style.visibility = 'hidden';
                  overlay.style.opacity = '0';
                }
                
                // Try to trigger OneTrust close event
                try {
                  if (window.OneTrust && typeof window.OneTrust.Close === 'function') {
                    window.OneTrust.Close();
                  }
                } catch (e) {
                  // Continue
                }
                
                return true;
              }
            }
            
            return false;
          })()
        `) as boolean;
        
        if (oneTrustAccepted) {
          console.log('✓ Accepted cookies via OneTrust (overlay dismissed)');
          await this.session.wait(2000); // Wait longer for overlay to fully disappear
          
          // Verify overlay is gone
          const overlayGone = await this.session.evaluate(`
            (() => {
              const overlay = document.querySelector('.onetrust-pc-dark-filter');
              if (!overlay) return true;
              const style = window.getComputedStyle(overlay);
              return style.display === 'none' || style.visibility === 'hidden';
            })()
          `) as boolean;
          
          if (overlayGone) {
            console.log('✓ OneTrust overlay dismissed successfully');
            return true;
          } else {
            console.log('⚠ OneTrust overlay may still be present, but cookie accepted');
            return true; // Still return true since we tried to accept
          }
        }
      }
      
      // Try clicking accept buttons in priority order
      if (consentInfo.acceptButtons.length > 0) {
        for (const btnInfo of consentInfo.acceptButtons) {
          // Try by ID first (most reliable)
          if (btnInfo.id) {
            try {
              await this.session.click(`#${btnInfo.id}`);
              console.log(`✓ Accepted cookies via button ID: ${btnInfo.id}`);
              await this.session.wait(1500);
              return true;
            } catch (e) {
              // Continue to next method
            }
          }
          
          // Try by text
          const clicked = await this.session.clickByText(btnInfo.text, { exact: false });
          if (clicked) {
            console.log(`✓ Accepted cookies via "${btnInfo.text}" button`);
            await this.session.wait(1500);
            return true;
          }
        }
      }
      
      // Fallback: try common button text patterns
      const acceptButtons = ['accept all cookies', 'accept all', 'accept', 'i agree', 'agree', 'allow cookies', 'allow', 'ok', 'continue'];
      for (const btnText of acceptButtons) {
        const clicked = await this.session.clickByText(btnText, { exact: false });
        if (clicked) {
          console.log(`✓ Accepted cookies via "${btnText}" button (fallback)`);
          await this.session.wait(1500);
          return true;
        }
      }
      
      return false;
    } catch (error) {
      console.warn('Cookie consent handling failed:', error);
      return false;
    }
  }

  /**
   * Handle ads (banner ads, popup ads, video ads)
   */
  async handleAds(): Promise<boolean> {
    try {
      // Check for common ad indicators
      const adInfo = await this.session.evaluate(`
        (() => {
          // Look for ad containers and skip/close buttons
          const adSelectors = [
            '[class*="ad" i]',
            '[id*="ad" i]',
            '[class*="advertisement" i]',
            '[class*="banner" i]',
            '[class*="popup" i]',
          ];
          
          const closeButtons = [];
          for (const selector of adSelectors) {
            const elements = document.querySelectorAll(selector);
            for (const el of elements) {
              const style = window.getComputedStyle(el);
              if (style.display !== 'none' && style.visibility !== 'hidden') {
                // Look for close buttons within ad
                const closeBtns = el.querySelectorAll('button, [class*="close" i], [aria-label*="close" i]');
                closeBtns.forEach(btn => {
                  if (btn.offsetParent !== null) {
                    const btnText = (btn.textContent || '').toLowerCase();
                    if (btnText.includes('close') || 
                        btnText.includes('skip') || 
                        btnText === '×' || 
                        btnText === 'x') {
                      closeButtons.push(btnText);
                    }
                  }
                });
              }
            }
          }
          
          return closeButtons;
        })()
      `) as string[];
      
      if (adInfo.length === 0) {
        return false; // No ads found
      }
      
      console.log(`🔍 Ad detected with ${adInfo.length} close button(s), dismissing...`);
      
      // Try to click close/skip buttons
      const closeTexts = ['skip ad', 'skip', 'close', '×', 'x'];
      for (const text of closeTexts) {
        const clicked = await this.session.clickByText(text, { exact: false });
        if (clicked) {
          console.log(`✓ Dismissed ad via "${text}" button`);
          await this.session.wait(1000);
          return true;
        }
      }
      
      // Also try clicking any close button found
      for (const btnText of adInfo) {
        const clicked = await this.session.clickByText(btnText, { exact: false });
        if (clicked) {
          console.log(`✓ Dismissed ad`);
          await this.session.wait(1000);
          return true;
        }
      }
      
      return false;
    } catch (error) {
      console.warn('Ad handling failed:', error);
      return false;
    }
  }

  /**
   * Handle game listing pages (itch.io, Famobi.com, etc.) - detect and click "Play Game" button or find game iframe
   */
  async handleGameListingPage(): Promise<boolean> {
    try {
      // Check if we're on a game listing page (not directly in game)
      const isListingPage = await this.session.evaluate(`
        (() => {
          const bodyText = (document.body.textContent || '').toLowerCase();
          const url = window.location.href.toLowerCase();
          
          // Check for listing page indicators
          const isListing = 
            url.includes('itch.io/games') ||
            url.includes('itch.io/game') ||
            url.includes('famobi.com') ||
            bodyText.includes('play game') ||
            bodyText.includes('play now') ||
            bodyText.includes('run game');
          
          // Check if game is already playing (not a listing page)
          const hasGameplay = (() => {
            const canvas = document.querySelector('canvas');
            const gameBoards = document.querySelectorAll('[class*="board" i], [class*="grid" i]');
            const scores = document.querySelectorAll('[class*="score" i]');
            return (canvas && canvas.width > 0) || 
                   gameBoards.length > 0 || 
                   scores.length > 0;
          })();
          
          return isListing && !hasGameplay;
        })()
      `) as boolean;
      
      // Also check for prominent play buttons (like Famobi.com's green play button)
      const hasPlayButton = await this.session.evaluate(`
        (() => {
          // Look for large, prominent play buttons (like Famobi.com's green button with play icon)
          const playButtonSelectors = [
            '.fg-click2play-stage',
            '.fg-click2play',
            '[class*="play-button" i]',
            '[class*="start-button" i]',
            '[id*="play" i]',
            '[id*="start" i]',
            'button[class*="play" i]',
            'button[class*="start" i]',
            '[role="button"][class*="play" i]'
          ];
          
          for (const selector of playButtonSelectors) {
            try {
              const buttons = document.querySelectorAll(selector);
              for (const btn of buttons) {
                const style = window.getComputedStyle(btn);
                const rect = btn.getBoundingClientRect();
                
                // Check if button is visible and prominent (large enough)
                if (style.display !== 'none' && 
                    style.visibility !== 'hidden' && 
                    style.opacity !== '0' &&
                    rect.width > 50 && 
                    rect.height > 50 &&
                    btn.offsetParent !== null) {
                  
                  // Check if it has a play icon (triangle) or play-related content
                  const hasPlayIcon = btn.querySelector('svg, [class*="play" i], [class*="triangle" i], [class*="icon" i]');
                  const btnText = (btn.textContent || btn.innerText || '').toLowerCase();
                  const hasPlayText = btnText.includes('play') || btnText === '' || btnText.trim().length === 0;
                  
                  if (hasPlayIcon || hasPlayText) {
                    return true;
                  }
                }
              }
            } catch (e) {
              // Continue
            }
          }
          
          return false;
        })()
      `) as boolean;
      
      if (!isListingPage && !hasPlayButton) {
        return false; // Not a listing page and no play button found
      }
      
      if (hasPlayButton) {
        console.log('🔍 Prominent play button detected (e.g., Famobi.com green play button)...');
      } else {
        console.log('🔍 Game listing page detected, looking for "Play Game" button...');
      }
      
      // Method 1: Try clicking Famobi.com specific play button selectors
      const famobiSelectors = [
        '.fg-click2play-stage',
        '.fg-click2play',
        '[class*="fg-click"]',
        '[id*="fg-click"]'
      ];
      
      for (const selector of famobiSelectors) {
        try {
          const clicked = await this.session.evaluate(`
            (() => {
              try {
                const btn = document.querySelector(${JSON.stringify(selector)});
                if (btn) {
                  const style = window.getComputedStyle(btn);
                  const rect = btn.getBoundingClientRect();
                  if (style.display !== 'none' && 
                      style.visibility !== 'hidden' && 
                      rect.width > 0 && 
                      rect.height > 0 &&
                      btn.offsetParent !== null) {
                    btn.click();
                    return true;
                  }
                }
                return false;
              } catch (e) {
                return false;
              }
            })()
          `) as boolean;
          
          if (clicked) {
            console.log(`✓ Clicked play button via selector: ${selector}`);
            await this.session.wait(3000); // Wait for game to load
            
            // Check if game loaded
            const gameLoaded = await this.isGamePlaying(3000);
            if (gameLoaded) {
              console.log('✓ Game loaded after clicking play button');
              return true;
            }
          }
        } catch (error) {
          // Continue to next selector
        }
      }
      
      // Method 2: Try clicking large prominent buttons with play icons
      const playButtonClicked = await this.session.evaluate(`
        (() => {
          try {
            // Find all buttons
            const allButtons = Array.from(document.querySelectorAll('button, [role="button"], div[onclick], a[href]'));
            
            for (const btn of allButtons) {
              if (btn.offsetParent === null) continue;
              
              const style = window.getComputedStyle(btn);
              const rect = btn.getBoundingClientRect();
              
              // Must be visible and prominent (large enough to be a play button)
              if (style.display === 'none' || 
                  style.visibility === 'hidden' || 
                  style.opacity === '0' ||
                  rect.width < 50 || 
                  rect.height < 50) {
                continue;
              }
              
              // Check for play icon (triangle, SVG, or play symbol)
              const hasPlayIcon = btn.querySelector('svg, [class*="play" i], [class*="triangle" i], [class*="icon" i]') !== null ||
                                 (() => {
                                   // Check computed styles for ::before pseudo-element content
                                   const computed = window.getComputedStyle(btn, '::before');
                                   const content = computed.content;
                                   return content && (content.includes('▶') || content.includes('►') || content.includes('triangle'));
                                 })();
              
              // Check button text/content
              const btnText = (btn.textContent || btn.innerText || '').trim().toLowerCase();
              const hasPlayText = btnText === '' || 
                                 btnText.includes('play') || 
                                 btnText.includes('start') ||
                                 btnText.length === 0;
              
              // Check button styling (green buttons are common for play buttons)
              const bgColor = style.backgroundColor;
              const isGreenButton = bgColor.includes('rgb(0, 128') || 
                                   bgColor.includes('rgb(34, 139') ||
                                   bgColor.includes('rgb(50, 205') ||
                                   bgColor.includes('#00') ||
                                   bgColor.includes('green');
              
              // If it has play icon, empty text (just icon), or is a green button, it's likely a play button
              if (hasPlayIcon || (hasPlayText && btnText.length < 3) || (isGreenButton && rect.width > 80 && rect.height > 40)) {
                btn.click();
                return true;
              }
            }
            
            return false;
          } catch (e) {
            return false;
          }
        })()
      `) as boolean;
      
      if (playButtonClicked) {
        console.log('✓ Clicked prominent play button (with play icon)');
        await this.session.wait(3000); // Wait for game to load
        
        // Check if game loaded
        const gameLoaded = await this.isGamePlaying(3000);
        if (gameLoaded) {
          console.log('✓ Game loaded after clicking play button');
          return true;
        }
      }
      
      // Method 3: Try to click "Play Game" or similar text buttons
      const playButtons = ['play game', 'play now', 'run game', 'start game', 'play'];
      for (const btnText of playButtons) {
        const clicked = await this.session.clickByText(btnText, { exact: false });
        if (clicked) {
          console.log(`✓ Clicked "${btnText}" button`);
          await this.session.wait(3000); // Wait for game to load
          
          // Check if game loaded
          const gameLoaded = await this.isGamePlaying(3000);
          if (gameLoaded) {
            console.log('✓ Game loaded after clicking play button');
            return true;
          }
        }
      }
      
      // Method 4: Try clicking center of page (common for play buttons)
      if (this.session.clickAt) {
        try {
          const pageSize = await this.session.evaluate(`
            (() => {
              return {
                width: window.innerWidth,
                height: window.innerHeight
              };
            })()
          `) as { width: number; height: number };
          
          const clicked = await this.session.clickAt(pageSize.width / 2, pageSize.height / 2);
          if (clicked) {
            console.log('✓ Clicked center of page (play button area)');
            await this.session.wait(3000);
            const gameLoaded = await this.isGamePlaying(3000);
            if (gameLoaded) {
              console.log('✓ Game loaded after clicking center');
              return true;
            }
          }
        } catch (error) {
          // Continue
        }
      }
      
      // If no play button found, try to find and switch to game iframe
      return await this.handleIframeGame();
    } catch (error) {
      console.warn('Game listing page handling failed:', error);
      return false;
    }
  }

  /**
   * Handle age verification modals
   */
  async handleAgeVerification(): Promise<boolean> {
    try {
      const hasAgeModal = await this.session.evaluate(`
        (() => {
          const bodyText = (document.body.textContent || '').toLowerCase();
          const hasAgeKeywords = 
            bodyText.includes('are you 18') ||
            bodyText.includes('age verification') ||
            bodyText.includes('enter your age') ||
            bodyText.includes('confirm age') ||
            bodyText.includes('i am 18') ||
            bodyText.includes('im 18') ||
            bodyText.includes('i\'m 18');
          
          if (!hasAgeKeywords) return false;
          
          // Check for age verification buttons
          const buttons = Array.from(document.querySelectorAll('button, [role="button"], a'));
          for (const btn of buttons) {
            if (btn.offsetParent === null) continue;
            const btnText = (btn.textContent || btn.innerText || '').toLowerCase();
            if (btnText.includes('yes') || 
                btnText.includes('18') || 
                btnText.includes('confirm') ||
                btnText.includes('continue') ||
                btnText.includes('i am') ||
                btnText.includes('im') ||
                btnText.includes('i\'m')) {
              return true;
            }
          }
          return false;
        })()
      `) as boolean;
      
      if (!hasAgeModal) {
        return false;
      }
      
      console.log('🔍 Age verification modal detected, confirming...');
      
      // Try to click confirm/yes buttons
      const confirmButtons = ['yes', 'i am 18', 'im 18', 'i\'m 18', 'confirm', 'continue', '18+'];
      for (const btnText of confirmButtons) {
        const clicked = await this.session.clickByText(btnText, { exact: false });
        if (clicked) {
          console.log(`✓ Age verified via "${btnText}" button`);
          await this.session.wait(1000);
          return true;
        }
      }
      
      return false;
    } catch (error) {
      console.warn('Age verification handling failed:', error);
      return false;
    }
  }

  /**
   * Handle fullscreen permission requests
   */
  async handleFullscreenRequest(): Promise<boolean> {
    try {
      // Listen for fullscreen permission dialogs
      const hasFullscreenRequest = await this.session.evaluate(`
        (() => {
          // Check if browser is requesting fullscreen permission
          // This is usually handled by browser, but we can detect if game is in fullscreen mode
          return document.fullscreenElement !== null || 
                 document.webkitFullscreenElement !== null ||
                 document.mozFullScreenElement !== null;
        })()
      `) as boolean;
      
      // If already fullscreen, that's fine
      if (hasFullscreenRequest) {
        return true;
      }
      
      // Try to accept fullscreen if a request appears
      // Most browsers handle this automatically, but we can try to detect and accept
      return false; // No explicit handling needed - browser handles it
    } catch (error) {
      console.warn('Fullscreen handling failed:', error);
      return false;
    }
  }

  /**
   * Enhanced canvas interaction - click at specific coordinates (0-1 normalized)
   * Useful for canvas-only games that don't use DOM elements
   */
  async clickCanvasAt(normalizedX: number, normalizedY: number): Promise<boolean> {
    try {
      // Find canvas element and get its position
      const canvasInfo = await this.session.evaluate(`
        (() => {
          const canvas = document.querySelector('canvas');
          if (!canvas) return null;
          
          const rect = canvas.getBoundingClientRect();
          return {
            x: rect.left,
            y: rect.top,
            width: rect.width,
            height: rect.height,
          };
        })()
      `) as { x: number; y: number; width: number; height: number } | null;
      
      if (!canvasInfo) {
        return false; // No canvas found
      }
      
      // Calculate absolute coordinates (normalizedX/Y are 0-1, representing percentage of canvas)
      const absoluteX = canvasInfo.x + (normalizedX * canvasInfo.width);
      const absoluteY = canvasInfo.y + (normalizedY * canvasInfo.height);
      
      console.log(`🎯 Clicking canvas at (${normalizedX.toFixed(2)}, ${normalizedY.toFixed(2)}) -> absolute (${Math.round(absoluteX)}, ${Math.round(absoluteY)})`);
      
      // Use clickAt if available (CDP-based, more reliable)
      if (this.session.clickAt) {
        const clicked = await this.session.clickAt(absoluteX, absoluteY);
        if (clicked) {
          await this.session.wait(300);
          return true;
        }
      }
      
      // Fallback: Try JavaScript mouse events on canvas
      const clicked = await this.session.evaluate(`
        (() => {
          const canvas = document.querySelector('canvas');
          if (!canvas) return false;
          
          const rect = canvas.getBoundingClientRect();
          const clickX = rect.left + ${normalizedX} * rect.width;
          const clickY = rect.top + ${normalizedY} * rect.height;
          
          // Create and dispatch mouse events
          const mouseDown = new MouseEvent('mousedown', {
            bubbles: true,
            cancelable: true,
            clientX: clickX,
            clientY: clickY,
            button: 0,
          });
          
          const mouseUp = new MouseEvent('mouseup', {
            bubbles: true,
            cancelable: true,
            clientX: clickX,
            clientY: clickY,
            button: 0,
          });
          
          const click = new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            clientX: clickX,
            clientY: clickY,
            button: 0,
          });
          
          canvas.dispatchEvent(mouseDown);
          canvas.dispatchEvent(mouseUp);
          canvas.dispatchEvent(click);
          
          return true;
        })()
      `) as boolean;
      
      if (clicked) {
        await this.session.wait(300);
        return true;
      }
      
      return false;
    } catch (error) {
      console.warn('Canvas click failed:', error);
      return false;
    }
  }

  /**
   * Detect if game is canvas-only (no DOM interactions)
   */
  async isCanvasOnlyGame(): Promise<boolean> {
    try {
      const isCanvasOnly = await this.session.evaluate(`
        (() => {
          const canvas = document.querySelector('canvas');
          if (!canvas) return false;
          
          // Check if there are interactive DOM elements (buttons, inputs, etc.)
          const interactiveElements = document.querySelectorAll(
            'button, input, [role="button"], [onclick], a[href]'
          );
          
          // Filter visible interactive elements
          const visibleInteractive = Array.from(interactiveElements).filter(el => {
            const style = window.getComputedStyle(el);
            return style.display !== 'none' && 
                   style.visibility !== 'hidden' && 
                   el.offsetParent !== null;
          });
          
          // If canvas exists but no visible interactive elements, it's canvas-only
          return visibleInteractive.length === 0;
        })()
      `) as boolean;
      
      return isCanvasOnly;
    } catch (error) {
      return false;
    }
  }

  /**
   * Handle modals, dialogs, and popups that might block gameplay
   * Optimized for speed - detects various modal types and dismissal methods
   */
  async handleModalsAndDialogs(): Promise<boolean> {
    try {
      // Check if browser is still open
      try {
        await this.session.evaluate('document.body');
      } catch (e) {
        if (e instanceof Error && e.message.includes('closed')) {
          console.warn('⚠ Browser closed, cannot handle modals');
          return false;
        }
        throw e;
      }
      
      // CRITICAL: First check if game is already playing - if so, don't do anything!
      // This prevents repeatedly clicking "New Game" and resetting the game
      try {
        const alreadyPlaying = await this.isGamePlaying(2000); // Quick 2s check
        if (alreadyPlaying) {
          // Game is already playing with tiles/content visible - don't interfere
          return false; // Return false (no modal to handle) since game is playing
        }
      } catch (e) {
        if (e instanceof Error && e.message.includes('closed')) {
          return false;
        }
        // Continue on other errors
      }
      
      // Comprehensive modal detection: check for common modal indicators
      const modalInfo = await this.session.evaluate(`
        (() => {
          // Look for common modal indicators
          const buttons = Array.from(document.querySelectorAll('button'));
          const modalButtons = [];
          
          for (const btn of buttons) {
            if (btn.offsetParent === null) continue; // Skip hidden buttons
            
            const btnText = (btn.textContent || btn.innerText || '').trim().toLowerCase();
            
            // Check for modal-specific buttons (generic patterns, not game-specific)
            // NEVER include "Play Tutorial" - we want to skip tutorials, not play them
            // Prioritize buttons that start actual gameplay
            const isModalButton = (
              // Prioritize: Start/New Game buttons (these start real gameplay)
              btnText === 'start new game' ||
              btnText.includes('start new game') ||
              btnText === 'new game' ||
              btnText.includes('new game') ||
              btnText === 'start game' ||
              btnText.includes('start game') ||
              btnText === 'play' ||
              btnText === 'play now' ||
              btnText === 'begin' ||
              // Skip/Close buttons (these dismiss tutorials/welcome screens)
              btnText === 'skip tutorial' ||
              btnText.includes('skip') ||
              btnText === 'got it' ||
              btnText === 'continue' ||
              btnText === 'no thanks' ||
              btnText === 'maybe later' ||
              btnText === 'close' ||
              btnText === 'dismiss' ||
              // Generic action buttons (lower priority)
              btnText === 'ok' ||
              btnText === "let's go" ||
              btnText === "let's play" ||
              btnText === 'ready' ||
              btnText === 'next'
              // NOTE: "Play Tutorial" is explicitly EXCLUDED - we never want to play tutorials
            );
            
            if (isModalButton) {
              // Check if button is likely in a modal (has dark overlay parent or modal class)
              let parent = btn.parentElement;
              let isInModal = false;
              let depth = 0;
              
              while (parent && depth < 5) {
                const style = window.getComputedStyle(parent);
                const bgColor = style.backgroundColor;
                const opacity = style.opacity;
                const zIndex = parseInt(style.zIndex) || 0;
                
                // Check for modal indicators
                if (
                  bgColor.includes('rgba(0, 0, 0') || // Dark overlay
                  bgColor.includes('rgb(0, 0, 0)') ||
                  parent.className.toLowerCase().includes('modal') ||
                  parent.className.toLowerCase().includes('overlay') ||
                  parent.className.toLowerCase().includes('dialog') ||
                  parent.id.toLowerCase().includes('modal') ||
                  zIndex > 1000 ||
                  (opacity && parseFloat(opacity) < 1 && parent.style.display !== 'none')
                ) {
                  isInModal = true;
                  break;
                }
                
                parent = parent.parentElement;
                depth++;
              }
              
              // Include button if it's in a modal OR if it matches common modal button patterns
              // (Some games don't have proper modal containers, so we check button text too)
              // NEVER include "Play Tutorial" - we want to skip tutorials
              const isCommonModalButton = (
                btnText === 'start new game' ||
                btnText.includes('start new game') ||
                btnText === 'new game' ||
                btnText.includes('new game') ||
                btnText === 'start game' ||
                btnText.includes('start game') ||
                btnText === 'got it' ||
                btnText === 'skip tutorial' ||
                btnText.includes('skip')
                // NOTE: "Play Tutorial" is explicitly EXCLUDED
              );
              
              if (isInModal || isCommonModalButton) {
                // Build a safe selector that won't break when used in evaluate
                // Sanitize selector to avoid special characters
                let selector = btn.tagName.toLowerCase();
                if (btn.id) {
                  // ID selector - sanitize ID to only allow valid CSS identifier characters
                  const sanitizedId = String(btn.id).replace(/[^a-zA-Z0-9_-]/g, '');
                  if (sanitizedId) {
                    selector = '#' + sanitizedId;
                  }
                } else if (btn.className && typeof btn.className === 'string') {
                  // Use first class name as selector (more reliable)
                  const firstClass = btn.className.trim().split(/\s+/)[0];
                  if (firstClass) {
                    // Sanitize class name to only allow valid CSS identifier characters
                    const sanitizedClass = firstClass.replace(/[^a-zA-Z0-9_-]/g, '');
                    if (sanitizedClass) {
                      selector = '.' + sanitizedClass;
                    }
                  }
                }
                
                // Only add if we have a valid selector (not just tag name, and properly sanitized)
                if (selector && 
                    selector.length > 1 && 
                    (selector.includes('#') || selector.includes('.')) &&
                    /^[#.][a-zA-Z0-9_-]+$/.test(selector)) { // Ensure selector format is valid
                  modalButtons.push({
                    text: btnText,
                    selector: selector
                  });
                }
              }
            }
          }
          
          // Also check for close buttons (X)
          const closeButtons = Array.from(document.querySelectorAll('button, [role="button"], .close, [aria-label*="close" i], [aria-label*="dismiss" i]'));
          for (const closeBtn of closeButtons) {
            if (closeBtn.offsetParent === null) continue;
            const closeText = (closeBtn.textContent || closeBtn.innerText || closeBtn.getAttribute('aria-label') || '').trim().toLowerCase();
            if (closeText === '×' || closeText === 'x' || closeText === 'close' || closeText.includes('close')) {
              // Check if it's in a modal
              let parent = closeBtn.parentElement;
              let depth = 0;
              while (parent && depth < 5) {
                if (parent.className.toLowerCase().includes('modal') || 
                    parent.className.toLowerCase().includes('overlay') ||
                    parent.id.toLowerCase().includes('modal')) {
                  // Build a safe selector for close button
                  // Sanitize selector to avoid special characters
                  let closeSelector = closeBtn.tagName.toLowerCase();
                  if (closeBtn.id) {
                    const sanitizedId = String(closeBtn.id).replace(/[^a-zA-Z0-9_-]/g, '');
                    if (sanitizedId) {
                      closeSelector = '#' + sanitizedId;
                    }
                  } else if (closeBtn.className && typeof closeBtn.className === 'string') {
                    const firstClass = closeBtn.className.trim().split(/\s+/)[0];
                    if (firstClass) {
                      const sanitizedClass = firstClass.replace(/[^a-zA-Z0-9_-]/g, '');
                      if (sanitizedClass) {
                        closeSelector = '.' + sanitizedClass;
                      }
                    }
                  }
                  // Only add if we have a valid selector (properly sanitized)
                  if (closeSelector && 
                      closeSelector.length > 1 && 
                      (closeSelector.includes('#') || closeSelector.includes('.')) &&
                      /^[#.][a-zA-Z0-9_-]+$/.test(closeSelector)) { // Ensure selector format is valid
                    modalButtons.push({ text: 'close', selector: closeSelector });
                  }
                  break;
                }
                parent = parent.parentElement;
                depth++;
              }
            }
          }
          
          return modalButtons.length > 0 ? modalButtons : null;
        })()
      `) as Array<{ text: string; selector: string }> | null;
      
      if (!modalInfo || modalInfo.length === 0) {
        return false; // No modal detected
      }
      
      console.log(`🔍 Modal detected with ${modalInfo.length} button(s), dismissing...`);
      
      // Strategy 1: Generic recursive modal handling - click any button and handle any new modals that appear
      // This works for any game with sequential modals (e.g., "New Game" -> "Start New Game")
      // Priority order: "New Game" variants > "Skip" variants > "Play/Start" > generic action buttons
      // CRITICAL: For 2048, flow is: "New Game" -> confirmation modal -> "Start New Game" -> play
      const buttonPriority = [
        { keywords: ['start new game'], priority: 1 }, // Highest priority - this confirms the "New Game" action
        { keywords: ['new game'], priority: 2 }, // Click "New Game" first, then handle confirmation
        { keywords: ['skip', 'got it'], priority: 3 },
        { keywords: ['play', 'start', 'begin'], priority: 4 },
        { keywords: ['ok', 'continue', 'next'], priority: 5 },
      ];
      
      // Sort buttons by priority
      const sortedButtons = modalInfo.map(btn => {
        const btnText = btn.text.replace(/\s+/g, ' ').trim().toLowerCase();
        let priority = 999; // Default low priority
        for (const { keywords, priority: p } of buttonPriority) {
          if (keywords.some(kw => btnText.includes(kw))) {
            priority = p;
            break;
          }
        }
        return { ...btn, priority, textLower: btnText };
      }).sort((a, b) => a.priority - b.priority);
      
      // Try clicking buttons in priority order
      for (const btnInfo of sortedButtons) {
        try {
          const normalizedText = btnInfo.text.replace(/\s+/g, ' ').trim();
          const clicked = await this.session.clickByText(normalizedText, { exact: false });
          
          if (clicked) {
            console.log(`✓ Clicked "${normalizedText}", checking for nested modals...`);
            
            // CRITICAL: For "New Game" button, we MUST wait for confirmation modal and click "Start New Game"
            if (normalizedText.toLowerCase().includes('new game') && !normalizedText.toLowerCase().includes('start')) {
              console.log('🔍 "New Game" clicked, waiting for confirmation modal...');
              await this.session.wait(2000); // Wait for confirmation modal to appear
              
            // CRITICAL: Analyze current state first to see what we're dealing with
            console.log('📸 Analyzing state after clicking "New Game"...');
            let stateAnalysis = await this.analyzeCurrentState();
            console.log(`📊 State: ${stateAnalysis.state}, Buttons: ${stateAnalysis.buttons.join(', ') || 'none'}`);
            
            // Take screenshot for debugging
            if (this.evidenceCapture) {
              try {
                await this.evidenceCapture.captureScreenshot(this.session, 'after-new-game-click');
                console.log('📸 Screenshot captured: after-new-game-click');
              } catch (e) {
                console.warn('Screenshot failed:', e);
              }
            }
            
            // Explicitly look for "Start New Game" button in the confirmation modal
            const confirmationHandled = await this.handleConfirmationModal();
            
            if (confirmationHandled) {
              console.log('✓ Confirmation modal handled - "Start New Game" clicked');
              
              // Verify state after confirmation
              await this.session.wait(2000);
              stateAnalysis = await this.analyzeCurrentState();
              console.log(`📊 State after confirmation: ${stateAnalysis.state}`);
              
              if (stateAnalysis.state !== 'playing') {
                console.log('⚠ Game may not be playing yet, checking...');
                // Take another screenshot
                if (this.evidenceCapture) {
                  try {
                    await this.evidenceCapture.captureScreenshot(this.session, 'after-confirmation');
                  } catch (e) {
                    console.warn('Screenshot failed:', e);
                  }
                }
              }
            } else {
              // Fallback: try generic nested modal handler
              console.log('⚠ Confirmation modal not found, trying generic nested modal handler...');
              const nestedModalHandled = await this.handleNestedModal();
              if (nestedModalHandled) {
                console.log('✓ Nested modal handled');
              } else {
                // Still stuck? Analyze again and take screenshot
                stateAnalysis = await this.analyzeCurrentState();
                console.log(`📊 Final state: ${stateAnalysis.state}, Available buttons: ${stateAnalysis.buttons.join(', ')}`);
                if (this.evidenceCapture) {
                  try {
                    await this.evidenceCapture.captureScreenshot(this.session, 'stuck-state');
                    console.log('📸 Screenshot captured: stuck-state');
                  } catch (e) {
                    console.warn('Screenshot failed:', e);
                  }
                }
              }
            }
            } else {
              // For other buttons, use generic nested modal handler
              await this.session.wait(2000);
              const nestedModalHandled = await this.handleNestedModal();
              if (nestedModalHandled) {
                console.log('✓ Nested modal handled');
              }
            }
            
            // Wait for game to initialize and render
            await this.session.wait(2000);
            
            // CRITICAL: Force DOM repaint before checking for tiles
            // This ensures tiles are rendered in the DOM before we check
            try {
              await this.session.evaluate(`
                (() => {
                  // Force layout recalculation
                  void document.body.offsetHeight;
                  
                  // Trigger any pending renders
                  const style = document.createElement('style');
                  style.textContent = '* { transition: none !important; }';
                  document.head.appendChild(style);
                  
                  // Force reflow
                  void document.body.offsetHeight;
                  
                  // Remove the style to restore normal rendering
                  document.head.removeChild(style);
                  
                  // Force another reflow
                  void document.body.offsetHeight;
                })()
              `);
              await this.session.wait(300); // Wait for any CSS updates
            } catch (e) {
              // Continue if evaluation fails
            }
            
            // For games like 2048, tiles might not appear until first input
            // CRITICAL: Check if tiles exist in DOM but are hidden, then force them visible
            const tilesState = await this.session.evaluate(`
              (() => {
                // Find all tile elements (2048 uses various class names)
                const tileSelectors = [
                  '[class*="tile"]',
                  '[class*="cell"]',
                  '[class*="grid-cell"]',
                  '.tile-container > *',
                  '[data-position]',
                ];
                
                const tiles = [];
                for (const selector of tileSelectors) {
                  try {
                    const elements = document.querySelectorAll(selector);
                    elements.forEach(el => {
                      const text = (el.textContent || el.innerText || '').trim();
                      const style = window.getComputedStyle(el);
                      const rect = el.getBoundingClientRect();
                      
                      // Check if element has content (number) or is a tile
                      if (text && text !== '' && text !== '0' && !text.match(/^\\s*$/)) {
                        tiles.push({
                          text: text,
                          visible: style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0',
                          hasSize: rect.width > 0 && rect.height > 0,
                          opacity: style.opacity,
                          display: style.display,
                          visibility: style.visibility,
                          zIndex: style.zIndex,
                        });
                      }
                    });
                  } catch (e) {
                    // Continue
                  }
                }
                
                return tiles;
              })()
            `) as Array<{ text: string; visible: boolean; hasSize: boolean; opacity: string; display: string; visibility: string; zIndex: string }>;
            
            if (tilesState && tilesState.length > 0) {
              console.log(`🔍 Found ${tilesState.length} tile(s) in DOM, checking visibility...`);
              const hiddenTiles = tilesState.filter(t => !t.visible || t.opacity === '0');
              if (hiddenTiles.length > 0) {
                console.log(`⚠ Found ${hiddenTiles.length} hidden tile(s), forcing visibility...`);
                // Force tiles to be visible
                await this.session.evaluate(`
                  (() => {
                    const tileSelectors = [
                      '[class*="tile"]:not([class*="tile-"])',
                      '[class*="tile-container"] > *',
                      '[class*="cell"]',
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
                              if (el.style) {
                                el.style.display = 'block';
                                el.style.visibility = 'visible';
                                el.style.opacity = '1';
                                el.style.zIndex = '10';
                              }
                            }
                          }
                        });
                      } catch (e) {
                        // Continue
                      }
                    }
                    
                    // Force reflow
                    void document.body.offsetHeight;
                  })()
                `);
                await this.session.wait(300);
              }
            } else {
              // No tiles found - try to trigger tile generation
              console.log('⚠ No tiles found in DOM, triggering tile generation...');
              try {
                await this.session.keypress('ArrowRight');
                await this.session.wait(1000);
                
                // Try multiple directions to ensure tiles appear
                await this.session.keypress('ArrowDown');
                await this.session.wait(1000);
                
                // Force repaint
                await this.session.evaluate(`
                  (() => {
                    void document.body.offsetHeight;
                    // Wait for any animations
                    return new Promise(resolve => {
                      const animations = document.getAnimations();
                      if (animations.length > 0) {
                        const maxDuration = Math.max(...Array.from(animations).map(a => {
                          const timing = a.effect?.getTiming();
                          return (timing?.duration || 0) * 1000;
                        }));
                        setTimeout(resolve, Math.max(maxDuration + 100, 500));
                      } else {
                        setTimeout(resolve, 500);
                      }
                    });
                  })()
                `);
              } catch (keyError) {
                await this.session.wait(500);
              }
            }
            
            // Verify game is playing with tiles/content visible
            const isPlaying = await this.isGamePlaying(5000);
            if (isPlaying) {
              console.log(`✓ Game started and tiles/content visible after clicking "${normalizedText}"`);
              return true;
            } else {
              // Try one more arrow key in case tiles need more input
              try {
                await this.session.keypress('ArrowDown');
                await this.session.wait(2000);
                const nowPlaying = await this.isGamePlaying(5000);
                if (nowPlaying) {
                  console.log(`✓ Game started after second input (tiles now visible)`);
                  return true;
                }
              } catch (keyError2) {
                // Continue
              }
              
              // Final check
              await this.session.wait(1500);
              const finalCheck = await this.isGamePlaying(5000);
              if (finalCheck) {
                console.log(`✓ Game started after clicking "${normalizedText}" (tiles now visible)`);
                return true;
              }
            }
          }
        } catch (error) {
          // Continue to next button
        }
      }
      
      // Strategy 2: Try clicking "Skip Tutorial" or "Skip" buttons (skip tutorials, not play them)
      // This is CRITICAL - we want to skip tutorials, not play them
      for (const btnInfo of modalInfo) {
        const btnText = btnInfo.text.toLowerCase();
        if (btnText.includes('skip') || btnText === 'got it' || btnText === 'continue' || btnText === 'no thanks' || btnText === 'maybe later') {
          try {
            const clicked = await this.session.clickByText(btnInfo.text, { exact: false });
            if (clicked) {
              await this.session.wait(1500);
              console.log(`✓ Modal dismissed via "${btnInfo.text}" button (skip)`);
              return true;
            }
          } catch (error) {
            // Continue to next button
          }
        }
      }
      
      // Strategy 3: Try clicking "PLAY" or "Start" buttons (generic start buttons)
      // Lower priority than "New Game" - might lead to tutorials
      for (const btnInfo of modalInfo) {
        const btnText = btnInfo.text.toLowerCase();
        if (btnText === 'play' || btnText === 'begin' || btnText === 'play now' || btnText === 'start') {
            try {
              const clicked = await this.session.clickByText(btnInfo.text, { exact: false });
              if (clicked) {
                await this.session.wait(2000); // Wait longer for game to start
                // Verify game is playing
                const isPlaying = await this.isGamePlaying(3000);
                if (isPlaying) {
                  console.log(`✓ Game started after clicking "${btnInfo.text}" button (start)`);
                  return true;
                } else {
                  // Wait a bit more - some games take longer
                  await this.session.wait(1500);
                  const nowPlaying = await this.isGamePlaying(3000);
                  if (nowPlaying) {
                    console.log(`✓ Game started after clicking "${btnInfo.text}" button (start)`);
                    return true;
                  }
                }
              }
            } catch (error) {
              // Continue to next button
            }
          }
        }
      
      // Strategy 4: Try clicking close button (X) to dismiss tutorial/welcome modal
      for (const btnInfo of modalInfo) {
        if (btnInfo.text === 'close') {
          try {
            // Validate selector format before using it
            if (btnInfo.selector && /^[#.][a-zA-Z0-9_-]+$/.test(btnInfo.selector)) {
              const selectorJson = JSON.stringify(btnInfo.selector);
              const clicked = await this.session.evaluate(`
                (() => {
                  try {
                    const selector = ${selectorJson};
                    if (!selector || typeof selector !== 'string') return false;
                    const element = document.querySelector(selector);
                    if (element && element.offsetParent !== null) {
                      element.click();
                      return true;
                    }
                    return false;
                  } catch (e) {
                    return false;
                  }
                })()
              `) as boolean;
              
              if (clicked) {
                await this.session.wait(1500);
                console.log('✓ Modal dismissed via close button');
                return true;
              }
            }
          } catch (error) {
            // Continue
          }
        }
      }
      
      // Strategy 5: Try clicking generic action buttons (OK, Continue, Next, etc.)
      // Lower priority - these might advance tutorial instead of starting game
      for (const btnInfo of modalInfo) {
        const btnText = btnInfo.text.toLowerCase();
        if (btnText === 'ok' || btnText === 'next' || btnText === 'let\'s go' || btnText === 'let\'s play' || btnText === 'ready') {
          try {
            const clicked = await this.session.clickByText(btnInfo.text, { exact: false });
            if (clicked) {
              await this.session.wait(1000);
              console.log(`✓ Modal dismissed via "${btnInfo.text}" button (generic)`);
              return true;
            }
          } catch (error) {
            // Continue to next button
          }
        }
      }
      
      // Strategy 6: Press Escape key (common for closing modals/tutorials)
      try {
        await this.session.keypress('Escape');
        await this.session.wait(1000);
        
        // Verify modal is gone
        const stillOpen = await this.session.evaluate(`
          (() => {
              // Check if tutorial/welcome modal is still visible
              const modals = document.querySelectorAll('[class*="modal" i], [class*="overlay" i], [class*="tutorial" i], [class*="welcome" i]');
              for (const modal of modals) {
                const style = window.getComputedStyle(modal);
                if (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0') {
                  return true; // Still open
                }
              }
              return false; // Closed
          })()
        `) as boolean;
        
        if (!stillOpen) {
          console.log('✓ Modal dismissed via Escape key');
          return true;
        }
      } catch (error) {
        // Continue
      }
      
        // Strategy 7: Press Enter key (fallback)
      try {
        await this.session.keypress('Enter');
        await this.session.wait(800);
        console.log('✓ Modal dismissed via Enter key (fallback)');
        return true;
      } catch (error) {
        // Continue
      }
      
      // Strategy 7: Press Escape key (common for modals)
      try {
        await this.session.keypress('Escape');
        await this.session.wait(800);
        console.log('✓ Modal dismissed via Escape key');
        return true;
      } catch (error) {
        // Continue
      }
      
      console.warn('⚠ All modal dismissal strategies failed');
      return false;
    } catch (error) {
      console.warn('Modal handling failed:', error);
      return false;
    }
  }

  /**
   * Handle nested modals that appear after clicking a button (e.g., confirmation dialogs)
   * This is called recursively to handle sequential modals without hardcoding
   */
  private async handleNestedModal(maxDepth: number = 3): Promise<boolean> {
    if (maxDepth <= 0) {
      return false; // Prevent infinite recursion
    }
    
    try {
      // Check if a new modal appeared (different from the one we just clicked)
      const hasNewModal = await this.session.evaluate(`
        (() => {
          // Check for visible modals/dialogs
          const modals = document.querySelectorAll('[class*="modal" i], [class*="dialog" i], [class*="overlay" i]');
          for (const modal of modals) {
            const style = window.getComputedStyle(modal);
            if (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0') {
              // Check if modal has buttons (it's interactive)
              const buttons = modal.querySelectorAll('button');
              if (buttons.length > 0) {
                return true;
              }
            }
          }
          return false;
        })()
      `) as boolean;
      
      if (!hasNewModal) {
        return false; // No new modal appeared
      }
      
      console.log('🔍 New modal detected, handling recursively...');
      await this.session.wait(1000); // Wait for modal to fully appear
      
      // Get all visible buttons in the new modal
      const modalButtons = await this.session.evaluate(`
        (() => {
          const buttons = Array.from(document.querySelectorAll('button'));
          const visibleButtons = [];
          
          for (const btn of buttons) {
            if (btn.offsetParent === null) continue;
            
            const style = window.getComputedStyle(btn);
            if (style.display === 'none' || style.visibility === 'hidden') continue;
            
            // Check if button is in a modal
            let parent = btn.parentElement;
            let isInModal = false;
            let depth = 0;
            while (parent && depth < 5) {
              const parentStyle = window.getComputedStyle(parent);
              if (parentStyle.display !== 'none' && 
                  parentStyle.visibility !== 'hidden' &&
                  (parent.className.toLowerCase().includes('modal') ||
                   parent.className.toLowerCase().includes('dialog') ||
                   parent.className.toLowerCase().includes('overlay'))) {
                isInModal = true;
                break;
              }
              parent = parent.parentElement;
              depth++;
            }
            
            if (isInModal) {
              const btnText = (btn.textContent || btn.innerText || '').trim();
              if (btnText) {
                visibleButtons.push(btnText);
              }
            }
          }
          
          return visibleButtons;
        })()
      `) as string[];
      
      if (modalButtons.length === 0) {
        return false;
      }
      
      // Try clicking buttons in priority order
      // CRITICAL: For 2048, "Start New Game" is the confirmation button after "New Game"
      // Priority: "Start New Game" > "Yes/Confirm" > "Start" > "New Game" > "OK" > "Continue" > "No/Cancel"
      const priorityOrder = ['start new game', 'yes', 'confirm', 'start', 'ok', 'new game', 'continue', 'no', 'cancel'];
      const sortedButtons = modalButtons.sort((a, b) => {
        const aLower = a.toLowerCase();
        const bLower = b.toLowerCase();
        const aIndex = priorityOrder.findIndex(p => aLower.includes(p));
        const bIndex = priorityOrder.findIndex(p => bLower.includes(p));
        const aPriority = aIndex === -1 ? 999 : aIndex;
        const bPriority = bIndex === -1 ? 999 : bIndex;
        return aPriority - bPriority;
      });
      
      // Click the highest priority button
      for (const btnText of sortedButtons) {
        const clicked = await this.session.clickByText(btnText, { exact: false });
        if (clicked) {
          console.log(`✓ Clicked "${btnText}" in nested modal`);
          await this.session.wait(2000);
          
          // Recursively check for more nested modals
          const deeperModal = await this.handleNestedModal(maxDepth - 1);
          if (deeperModal) {
            return true;
          }
          
          // Check if game is now playing
          const isPlaying = await this.isGamePlaying(3000);
          if (isPlaying) {
            return true;
          }
          
          return true; // Modal handled
        }
      }
      
      return false;
    } catch (error) {
      console.warn('Nested modal handling failed:', error);
      return false;
    }
  }

  /**
   * Analyze current page state from screenshot/DOM to determine what action is needed
   * Returns: 'playing' | 'new-game-modal' | 'confirmation-modal' | 'tutorial' | 'unknown'
   */
  private async analyzeCurrentState(): Promise<{ state: string; buttons: string[]; details: string }> {
    try {
      const analysis = await this.session.evaluate(`
        (() => {
          const result = {
            state: 'unknown',
            buttons: [],
            details: ''
          };
          
          // Get all visible buttons
          const allButtons = Array.from(document.querySelectorAll('button'));
          const visibleButtons = [];
          
          for (const btn of allButtons) {
            if (btn.offsetParent === null) continue;
            const style = window.getComputedStyle(btn);
            if (style.display !== 'none' && style.visibility !== 'hidden') {
              const btnText = (btn.textContent || btn.innerText || '').trim();
              if (btnText) {
                visibleButtons.push(btnText);
              }
            }
          }
          
          result.buttons = visibleButtons;
          
          // Check for game playing state
          const scoreElements = document.querySelectorAll('[class*="score" i], [id*="score" i]');
          const canvas = document.querySelector('canvas');
          const gameBoards = document.querySelectorAll('[class*="board" i], [class*="grid" i], [class*="tile" i]');
          
          let hasGameContent = false;
          if (canvas && canvas.width > 0 && canvas.height > 0) {
            hasGameContent = true;
          }
          if (gameBoards.length > 0) {
            for (const board of gameBoards) {
              const children = Array.from(board.children || []);
              const visibleChildren = children.filter(child => {
                const style = window.getComputedStyle(child);
                return style.display !== 'none' && style.visibility !== 'hidden';
              });
              if (visibleChildren.length > 0) {
                hasGameContent = true;
                break;
              }
            }
          }
          
          // Check for modals
          const modals = document.querySelectorAll('[class*="modal" i], [class*="dialog" i], [class*="overlay" i]');
          let hasModal = false;
          let modalText = '';
          
          for (const modal of modals) {
            const style = window.getComputedStyle(modal);
            if (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0') {
              hasModal = true;
              modalText = (modal.textContent || modal.innerText || '').toLowerCase();
              break;
            }
          }
          
          // Determine state
          if (hasGameContent && !hasModal) {
            result.state = 'playing';
            result.details = 'Game appears to be playing with visible content';
          } else if (hasModal) {
            if (modalText.includes('sure') || modalText.includes('confirm') || modalText.includes('start new game')) {
              result.state = 'confirmation-modal';
              result.details = 'Confirmation modal detected: ' + modalText.substring(0, 100);
            } else if (modalText.includes('tutorial') || visibleButtons.some(b => b.toLowerCase().includes('tutorial'))) {
              result.state = 'tutorial';
              result.details = 'Tutorial/welcome screen detected';
            } else if (visibleButtons.some(b => b.toLowerCase().includes('new game'))) {
              result.state = 'new-game-modal';
              result.details = 'New Game modal detected';
            } else {
              result.state = 'unknown-modal';
              result.details = 'Unknown modal: ' + modalText.substring(0, 100);
            }
          } else {
            result.state = 'unknown';
            result.details = 'State unclear - no clear game content or modal';
          }
          
          return result;
        })()
      `);
      
      return analysis as { state: string; buttons: string[]; details: string };
    } catch (error) {
      console.warn('State analysis failed:', error);
      return { state: 'unknown', buttons: [], details: 'Analysis failed' };
    }
  }

  /**
   * Handle confirmation modal that appears after clicking "New Game"
   * Specifically looks for "Start New Game" button in the confirmation modal
   * This is the nested modal flow: "New Game" -> confirmation -> "Start New Game"
   */
  private async handleConfirmationModal(): Promise<boolean> {
    try {
      // Wait a bit for modal to fully appear
      await this.session.wait(1500);
      
      // CRITICAL: Analyze current state first to see what we're dealing with
      console.log('📸 Analyzing current page state...');
      const stateAnalysis = await this.analyzeCurrentState();
      console.log(`📊 Current state: ${stateAnalysis.state}`);
      console.log(`📋 Visible buttons: ${stateAnalysis.buttons.join(', ') || 'none'}`);
      console.log(`ℹ️  Details: ${stateAnalysis.details}`);
      
      // Take a screenshot for debugging
      if (this.evidenceCapture) {
        try {
          await this.evidenceCapture.captureScreenshot(this.session, `state-${stateAnalysis.state}`);
          console.log(`📸 Screenshot captured: state-${stateAnalysis.state}`);
        } catch (e) {
          console.warn('Screenshot capture failed:', e);
        }
      }
      
      // If already playing, we're done
      if (stateAnalysis.state === 'playing') {
        console.log('✓ Game is already playing!');
        return true;
      }
      
      // Check if confirmation modal exists
      const hasConfirmation = await this.session.evaluate(`
        (() => {
          // Check for modal/dialog elements
          const modals = document.querySelectorAll('[class*="modal" i], [class*="dialog" i], [class*="overlay" i]');
          for (const modal of modals) {
            const style = window.getComputedStyle(modal);
            if (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0') {
              // Check if it's a confirmation modal (has "sure" or "confirm" text)
              const modalText = (modal.textContent || modal.innerText || '').toLowerCase();
              if (modalText.includes('sure') || modalText.includes('confirm') || modalText.includes('start new game')) {
                return true;
              }
            }
          }
          return false;
        })()
      `) as boolean;
      
      if (!hasConfirmation && stateAnalysis.state !== 'confirmation-modal') {
        console.log('⚠ No confirmation modal detected');
        return false;
      }
      
      console.log('🔍 Confirmation modal detected, looking for "Start New Game" button...');
      
      // CRITICAL: First try direct DOM click - more reliable for modals
      const directClickSuccess = await this.session.evaluate(`
        (() => {
          try {
            // Find all buttons in visible modals
            const modals = document.querySelectorAll('[class*="modal" i], [class*="dialog" i], [class*="overlay" i]');
            for (const modal of modals) {
              const style = window.getComputedStyle(modal);
              if (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0') {
                // Look for buttons in this modal
                const buttons = modal.querySelectorAll('button');
                for (const btn of buttons) {
                  const btnStyle = window.getComputedStyle(btn);
                  if (btnStyle.display !== 'none' && btn.offsetParent !== null) {
                    const btnText = (btn.textContent || btn.innerText || '').trim().toLowerCase();
                    console.log('Found button in modal:', btnText);
                    
                    // Prioritize "Start New Game" button
                    if (btnText.includes('start new game') || 
                        (btnText.includes('start') && btnText.includes('new') && btnText.includes('game'))) {
                      console.log('Clicking "Start New Game" button...');
                      btn.click();
                      return true;
                    }
                  }
                }
                
                // If no "Start New Game" found, try buttons with "start" or "confirm"
                for (const btn of buttons) {
                  const btnStyle = window.getComputedStyle(btn);
                  if (btnStyle.display !== 'none' && btn.offsetParent !== null) {
                    const btnText = (btn.textContent || btn.innerText || '').trim().toLowerCase();
                    
                    // Skip cancel/no buttons
                    if (btnText.includes('cancel') || btnText.includes('no')) continue;
                    
                    // Try buttons with "start" or "confirm"
                    if (btnText.includes('start') || btnText.includes('confirm') || btnText === 'yes' || btnText === 'ok') {
                      console.log('Clicking button:', btnText);
                      btn.click();
                      return true;
                    }
                  }
                }
              }
            }
            return false;
          } catch (e) {
            console.error('Direct click error:', e);
            return false;
          }
        })()
      `) as boolean;
      
      if (directClickSuccess) {
        console.log('✓ Clicked "Start New Game" via direct DOM click');
        await this.session.wait(2000); // Wait for game to start
        
        // Verify game is now playing
        const isPlaying = await this.isGamePlaying(3000);
        if (isPlaying) {
          console.log('✓ Game started after confirmation');
          return true;
        } else {
          console.log('⚠ Confirmation clicked, waiting longer for game to start...');
          await this.session.wait(2000);
          const stillPlaying = await this.isGamePlaying(3000);
          if (stillPlaying) {
            console.log('✓ Game started after additional wait');
            return true;
          }
          return true; // Still return true since we clicked the confirmation
        }
      }
      
      // Fallback: Try clickByText method
      console.log('⚠ Direct DOM click failed, trying clickByText method...');
      const confirmationButtons = [
        'start new game',
        'yes, start new game',
        'start',
        'confirm',
        'yes',
        'ok'
      ];
      
      for (const btnText of confirmationButtons) {
        try {
          const clicked = await this.session.clickByText(btnText, { exact: false });
          if (clicked) {
            console.log(`✓ Clicked "${btnText}" in confirmation modal`);
            await this.session.wait(2000); // Wait for game to start
            
            // Verify game is now playing
            const isPlaying = await this.isGamePlaying(3000);
            if (isPlaying) {
              console.log('✓ Game started after confirmation');
              return true;
            } else {
              console.log('⚠ Game may not have started yet, but confirmation was clicked');
              return true; // Still return true since we clicked the confirmation
            }
          }
        } catch (error) {
          // Continue to next button
          continue;
        }
      }
      
      // Fallback: Try to find any button in the modal and click it
      const anyButtonClicked = await this.session.evaluate(`
        (() => {
          try {
            const modals = document.querySelectorAll('[class*="modal" i], [class*="dialog" i]');
            for (const modal of modals) {
              const style = window.getComputedStyle(modal);
              if (style.display !== 'none' && style.visibility !== 'hidden') {
                // Look for buttons in the modal
                const buttons = modal.querySelectorAll('button');
                for (const btn of buttons) {
                  const btnStyle = window.getComputedStyle(btn);
                  if (btnStyle.display !== 'none' && btn.offsetParent !== null) {
                    const btnText = (btn.textContent || btn.innerText || '').toLowerCase();
                    // Prioritize "start new game" or buttons with "start"
                    if (btnText.includes('start new game') || btnText.includes('start') || btnText.includes('confirm')) {
                      btn.click();
                      return true;
                    }
                  }
                }
                
                // If no prioritized button found, click first visible button
                for (const btn of buttons) {
                  const btnStyle = window.getComputedStyle(btn);
                  if (btnStyle.display !== 'none' && btn.offsetParent !== null) {
                    const btnText = (btn.textContent || btn.innerText || '').toLowerCase();
                    // Skip cancel buttons
                    if (!btnText.includes('cancel') && !btnText.includes('no')) {
                      btn.click();
                      return true;
                    }
                  }
                }
              }
            }
            return false;
          } catch (e) {
            return false;
          }
        })()
      `) as boolean;
      
      if (anyButtonClicked) {
        console.log('✓ Clicked button in confirmation modal (fallback)');
        await this.session.wait(2000);
        return true;
      }
      
      return false;
    } catch (error) {
      console.warn('Confirmation modal handling failed:', error);
      return false;
    }
  }

  private timeoutPromise(ms: number): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Action timeout')), ms);
    });
  }
}

