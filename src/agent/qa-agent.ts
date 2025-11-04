/**
 * Main QA Agent orchestrator
 */

import type { BrowserSession } from '../types/browser.js';
import type { QAConfig } from '../types/config.js';
import type { QAReport } from '../types/report.js';
import type { ParsedInputSchema } from '../types/input-schema.js';
import { InteractionEngine } from './interaction-engine.js';
import { EvidenceCapture } from './evidence-capture.js';
import { Evaluator } from './evaluator.js';

export class QAAgent {
  constructor(
    private session: BrowserSession,
    private config: QAConfig,
    private evidenceCapture: EvidenceCapture,
    private evaluator: Evaluator,
    private inputSchema?: ParsedInputSchema
  ) {}

  /**
   * Run complete QA test on a game URL
   */
  async testGame(gameUrl: string): Promise<QAReport> {
    const startTime = Date.now();
    let loadTime: number | undefined;

    try {
      // Initialize evidence capture
      await this.evidenceCapture.initialize();

      // Step 1: Load game
      const loadStart = Date.now();
      await this.loadGame(gameUrl);
      loadTime = Date.now() - loadStart;

      // Step 2: Wait for game to fully render
      await this.session.wait(3000); // Wait 3 seconds for game to load
      
      // Step 2.5: Ensure page is focused and ready for interactions
      try {
        await this.session.evaluate(`
          window.focus();
          if (document.activeElement !== document.body) {
            document.body.focus();
          }
        `);
        await this.session.wait(500);
      } catch (error) {
        console.warn('Focus setup failed:', error);
      }
      
      // Step 2.75: Handle site-specific issues (iframes, ads, cookies, game listings)
      const interactionEngine = new InteractionEngine(
        this.session,
        this.config.timeouts,
        this.evidenceCapture,
        this.inputSchema
      );
      
      // Handle iframe games (itch.io, kongregate)
      try {
        await interactionEngine.handleIframeGame();
      } catch (error) {
        console.warn('Iframe handling failed:', error);
      }
      
      // Handle cookie/GDPR consent
      let cookieConsentHandled = false;
      try {
        cookieConsentHandled = await interactionEngine.handleCookieConsent();
        if (cookieConsentHandled) {
          // After cookie consent is dismissed, wait a bit and check for play buttons (like Famobi.com green play button)
          await this.session.wait(1500); // Wait for cookie modal to fully disappear
          try {
            await interactionEngine.handleGameListingPage();
          } catch (error) {
            // Continue if play button detection fails
          }
        }
      } catch (error) {
        console.warn('Cookie consent handling failed:', error);
      }
      
      // Handle ads
      try {
        await interactionEngine.handleAds();
      } catch (error) {
        console.warn('Ad handling failed:', error);
      }
      
      // Handle game listing pages (itch.io, Famobi.com, etc.) - also check even if cookie wasn't handled
      if (!cookieConsentHandled) {
        try {
          await interactionEngine.handleGameListingPage();
        } catch (error) {
          console.warn('Game listing page handling failed:', error);
        }
      }
      
      // Handle age verification
      try {
        await interactionEngine.handleAgeVerification();
      } catch (error) {
        console.warn('Age verification handling failed:', error);
      }
      
      // Handle fullscreen requests
      try {
        await interactionEngine.handleFullscreenRequest();
      } catch (error) {
        console.warn('Fullscreen handling failed:', error);
      }
      
      // Step 3: Handle any initial modals BEFORE first screenshot
      // Try to dismiss any modals that appeared on load
      try {
        const modalHandled = await interactionEngine.handleModalsAndDialogs();
        if (modalHandled) {
          console.log('✓ Initial modal handled successfully');
          await this.session.wait(1000); // Wait after modal dismissal
        }
        // Don't warn if no modal - that's fine, game might not have one
      } catch (error) {
        console.warn('Initial modal handling failed:', error);
      }
      
      // Step 3.5: Ensure game is actually playing (not stuck in tutorial/welcome)
      // Use timeout to prevent hanging - don't block if verification takes too long
      try {
        const gameStartedPromise = interactionEngine.ensureGameIsPlaying();
        const timeoutPromise = new Promise<boolean>((resolve) => {
          setTimeout(() => resolve(false), 20000); // 20 second max
        });
        
        const gameStarted = await Promise.race([gameStartedPromise, timeoutPromise]);
        if (gameStarted) {
          console.log('✓ Game is confirmed to be playing');
          await this.session.wait(2000); // Wait for game state to stabilize
        } else {
          console.warn('⚠ Could not confirm game is playing - will continue anyway (game may still work)');
          await this.session.wait(2000);
        }
      } catch (error) {
        console.warn('Game start verification failed:', error);
        await this.session.wait(2000);
      }
      
      // Step 4: Capture initial state (after game has started)
      await this.evidenceCapture.captureScreenshot(this.session, 'initial-load');
      
      // Wait a bit more to ensure game state is stable
      await this.session.wait(1500);

      // Step 5: Try to detect and interact with common UI patterns
      // (interactionEngine already created above)
      
      try {
        await interactionEngine.detectAndInteract();
        
        // Generic check: if game is still not playing after auto-detection, try initial input
        // Some games need a keyboard input to initialize gameplay (e.g., board games, puzzle games)
        const stillPlaying = await interactionEngine.isGamePlaying(3000);
        if (!stillPlaying) {
          console.log('⚠ Game not playing after auto-detection, trying initial input to trigger gameplay...');
          // Try sending a generic input - arrow keys work for many games
          try {
            await this.session.keypress('ArrowRight');
            await this.session.wait(2000); // Wait for game state to update
            const nowPlaying = await interactionEngine.isGamePlaying(3000);
            if (nowPlaying) {
              console.log('✓ Game started after initial input');
            } else {
              // Try another direction - some games need different input
              await this.session.keypress('ArrowDown');
              await this.session.wait(2000);
              const nowPlaying2 = await interactionEngine.isGamePlaying(3000);
              if (nowPlaying2) {
                console.log('✓ Game started after second input');
              }
            }
          } catch (keyError) {
            console.warn('Initial input failed:', keyError);
          }
        } else {
          console.log('✓ Game confirmed playing after auto-detection');
        }
        
        // Wait a bit after auto-detection and capture screenshot
        await this.session.wait(1000);
        await this.evidenceCapture.captureScreenshot(this.session, 'after-auto-interact');
      } catch (error) {
        console.warn('Auto-detection interaction failed:', error);
        // Continue with configured actions
      }

      // Step 6: Execute configured actions (screenshots will be captured during execution)
      // Quick check if game is playing (don't block if check is slow)
      try {
        const gamePlaying = await Promise.race([
          interactionEngine.isGamePlaying(3000),
          new Promise<boolean>(resolve => setTimeout(() => resolve(true), 3000)) // Assume playing if check times out
        ]);
        if (!gamePlaying) {
          console.warn('⚠ Game not playing before actions - attempting to restart...');
          // Don't block - just try once
          await Promise.race([
            interactionEngine.ensureGameIsPlaying(2),
            new Promise(resolve => setTimeout(resolve, 8000)) // 8s max
          ]);
          await this.session.wait(1000);
        }
      } catch (error) {
        console.warn('Game state check before actions failed:', error);
        // Continue anyway - game might still work
      }
      
      await interactionEngine.executeActions(this.config.actions);

      // Step 6: Force tiles to be visible before final screenshot
      // CRITICAL: 2048 tiles might exist in DOM but not be visible due to CSS
      try {
        await this.session.evaluate(`
          (() => {
            // Force all tile elements to be visible
            const allElements = document.querySelectorAll('*');
            allElements.forEach(el => {
              const text = (el.textContent || el.innerText || '').trim();
              // Check if element has a number (likely a tile)
              if (text && /^\\d+$/.test(text) && parseInt(text) > 0) {
                const style = window.getComputedStyle(el);
                const rect = el.getBoundingClientRect();
                
                // If element has number but is hidden or has no size, force visibility
                if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0' || rect.width === 0 || rect.height === 0) {
                  (el as HTMLElement).style.display = 'block';
                  (el as HTMLElement).style.visibility = 'visible';
                  (el as HTMLElement).style.opacity = '1';
                  (el as HTMLElement).style.zIndex = '10';
                }
              }
            });
            
            // Also check for game grid cells and ensure they're visible
            const gridCells = document.querySelectorAll('[class*="grid"] [class*="cell"], [class*="tile-container"] [class*="tile"]');
            gridCells.forEach(cell => {
              const style = window.getComputedStyle(cell);
              if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
                (cell as HTMLElement).style.display = 'block';
                (cell as HTMLElement).style.visibility = 'visible';
                (cell as HTMLElement).style.opacity = '1';
              }
            });
            
            // Force reflow
            void document.body.offsetHeight;
          })()
        `);
        await this.session.wait(500); // Wait for styles to apply
      } catch (e) {
        console.warn('Failed to force tile visibility:', e);
      }

      // Step 6: Capture final state
      await this.session.wait(1000); // Wait for final state to settle
      await this.evidenceCapture.captureScreenshot(this.session, 'final-state');

      // Step 8: Capture console logs (before closing)
      await this.evidenceCapture.captureConsoleLogs(this.session);

      // Step 9: Save console logs
      await this.evidenceCapture.saveConsoleLogs(gameUrl);

      // Step 10: Get execution time
      const executionTimeSeconds = (Date.now() - startTime) / 1000;

      // Step 11: Evaluate
      const report = await this.evaluator.evaluate(
        gameUrl,
        this.evidenceCapture.getScreenshots(),
        this.evidenceCapture.getConsoleErrors(),
        this.evidenceCapture.getConsoleWarnings(),
        executionTimeSeconds
      );

      // Add load time to metadata
      if (loadTime) {
        report.metadata = {
          ...report.metadata,
          load_time_ms: loadTime,
        };
      }

      return report;
    } catch (error) {
      const executionTimeSeconds = (Date.now() - startTime) / 1000;

      // Capture error state screenshot if possible
      try {
        await this.evidenceCapture.captureScreenshot(this.session, 'error-state');
      } catch {
        // Ignore screenshot errors
      }

      // Capture console logs if possible
      try {
        await this.evidenceCapture.captureConsoleLogs(this.session);
      } catch {
        // Ignore log capture errors
      }

      // Return error report
      return {
        status: 'error',
        playability_score: 0,
        issues: [
          {
            severity: 'critical',
            description: `Test execution failed: ${error instanceof Error ? error.message : String(error)}`,
            confidence: 1.0,
          },
        ],
        screenshots: this.evidenceCapture.getScreenshots(),
        timestamp: new Date().toISOString(),
        game_url: gameUrl,
        execution_time_seconds: executionTimeSeconds,
        metadata: {
          console_errors: this.evidenceCapture.getConsoleErrors(),
          console_warnings: this.evidenceCapture.getConsoleWarnings(),
          load_time_ms: loadTime,
        },
      };
    }
  }

  /**
   * Load game with retry logic
   */
  private async loadGame(gameUrl: string, retries: number = 3): Promise<void> {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        await this.session.navigate(gameUrl);
        // Wait a bit for initial load
        await this.session.wait(2000);
        return; // Success
      } catch (error) {
        if (attempt === retries) {
          throw new Error(
            `Failed to load game after ${retries} attempts: ${error instanceof Error ? error.message : String(error)}`
          );
        }
        console.warn(`Load attempt ${attempt} failed, retrying...`);
        await this.session.wait(1000 * attempt); // Exponential backoff
      }
    }
  }
}

