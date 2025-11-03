/**
 * AI evaluator using LLM to analyze game playability
 */

import OpenAI from 'openai';
import type { QAReport, Issue } from '../types/report.js';
import type { ScreenshotInfo } from '../types/report.js';

export class Evaluator {
  private client: OpenAI;
  private model: string;

  constructor(apiKey?: string, model: string = 'gpt-4o') {
    const key = apiKey || process.env.OPENAI_API_KEY;
    if (!key) {
      throw new Error(
        'OPENAI_API_KEY environment variable is required. Get your key at https://platform.openai.com'
      );
    }
    this.client = new OpenAI({ apiKey: key });
    this.model = model;
  }

  /**
   * Evaluate game playability based on evidence
   */
  async evaluate(
    gameUrl: string,
    screenshots: ScreenshotInfo[],
    consoleErrors: string[],
    consoleWarnings: string[],
    executionTimeSeconds: number
  ): Promise<QAReport> {
    // Filter out invalid screenshots
    const validScreenshots = screenshots.filter(s => s.filename && s.filename.length > 0);
    
    // Load screenshot images for vision analysis
    const screenshotBuffers = await this.loadScreenshots(validScreenshots);
    
    // Prepare evaluation prompt
    const evaluationPrompt = this.buildEvaluationPrompt(
      gameUrl,
      consoleErrors,
      consoleWarnings,
      executionTimeSeconds
    );

    try {
      // Use vision API if we have screenshots
      let analysis: string;
      if (screenshotBuffers.length > 0) {
        console.log(`Evaluating game with ${screenshotBuffers.length} screenshot(s) using GPT-4 Vision`);
        analysis = await this.analyzeWithVision(
          screenshotBuffers,
          evaluationPrompt
        );
      } else {
        // No screenshots = cannot properly evaluate
        console.error('CRITICAL: No valid screenshots available - cannot evaluate game playability');
        throw new Error('No screenshots captured - evaluation requires visual evidence');
      }

      // Parse structured response from LLM
      const parsed = this.parseEvaluationResponse(analysis);

      // Build report with only valid screenshots
      const report: QAReport = {
        status: parsed.status,
        playability_score: parsed.playability_score,
        issues: parsed.issues,
        screenshots: validScreenshots, // Use filtered valid screenshots
        timestamp: new Date().toISOString(),
        game_url: gameUrl,
        execution_time_seconds: executionTimeSeconds,
        metadata: {
          console_errors: consoleErrors,
          console_warnings: consoleWarnings,
        },
      };

      return report;
    } catch (error) {
      console.error('Evaluation failed:', error);
      // Return fallback report on error (use valid screenshots)
      return this.createFallbackReport(
        gameUrl,
        validScreenshots,
        consoleErrors,
        consoleWarnings,
        executionTimeSeconds
      );
    }
  }

  /**
   * Analyze screenshots using GPT-4 Vision
   */
  private async analyzeWithVision(
    screenshotBuffers: Buffer[],
    prompt: string
  ): Promise<string> {
    const messages: any[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          ...screenshotBuffers.map((buffer) => ({
            type: 'image_url',
            image_url: {
              url: `data:image/png;base64,${buffer.toString('base64')}`,
            },
          })),
        ],
      },
    ];

    const response = await this.client.chat.completions.create({
      model: this.model, // Use the configured model (gpt-4o supports vision)
      messages,
      max_tokens: 2000,
    });

    return response.choices[0]?.message?.content || '';
  }

  /**
   * Analyze text-only (fallback)
   */
  private async analyzeTextOnly(prompt: string): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 2000,
      response_format: { type: 'json_object' },
    });

    return response.choices[0]?.message?.content || '{}';
  }

  /**
   * Build evaluation prompt
   */
  private buildEvaluationPrompt(
    gameUrl: string,
    consoleErrors: string[],
    consoleWarnings: string[],
    executionTimeSeconds: number
  ): string {
    return `You are evaluating a browser game for playability. Analyze the provided screenshots and console information.

Game URL: ${gameUrl}
Execution Time: ${executionTimeSeconds} seconds
Console Errors: ${consoleErrors.length > 0 ? consoleErrors.join('; ') : 'None'}
Console Warnings: ${consoleWarnings.length > 0 ? consoleWarnings.join('; ') : 'None'}

Evaluate the following aspects:
1. Did the game load successfully? (Check for error screens, blank pages, failed renders)
2. Are controls responsive? (Look for UI feedback, game state changes)
3. Did the game complete without crashes? (Check for error messages, frozen states)

Provide a JSON response with this structure:
{
  "status": "pass" | "fail" | "partial" | "error",
  "playability_score": 0-100,
  "issues": [
    {
      "severity": "critical" | "warning" | "info",
      "description": "Clear description of the issue",
      "confidence": 0.0-1.0
    }
  ],
  "reasoning": "Brief explanation of your assessment"
}

Be strict: a game that doesn't load gets status "fail" and score 0-20. A fully playable game gets "pass" and 80-100.`;
  }

  /**
   * Parse evaluation response from LLM
   */
  private parseEvaluationResponse(response: string): {
    status: QAReport['status'];
    playability_score: number;
    issues: Issue[];
  } {
    try {
      // Try to extract JSON from response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      const jsonStr = jsonMatch ? jsonMatch[0] : response;
      const parsed = JSON.parse(jsonStr);

      return {
        status: parsed.status || 'partial',
        playability_score: Math.max(0, Math.min(100, parsed.playability_score || 50)),
        issues: Array.isArray(parsed.issues) ? parsed.issues : [],
      };
    } catch (error) {
      console.warn('Failed to parse LLM response, using defaults:', error);
      return {
        status: 'partial',
        playability_score: 50,
        issues: [
          {
            severity: 'warning',
            description: 'Could not parse AI evaluation response',
            confidence: 0.5,
          },
        ],
      };
    }
  }

  /**
   * Load screenshot files as buffers
   */
  private async loadScreenshots(
    screenshots: ScreenshotInfo[]
  ): Promise<Buffer[]> {
    const { readFile } = await import('fs/promises');
    const { join } = await import('path');
    const { existsSync } = await import('fs');

    const buffers: Buffer[] = [];
    for (const screenshot of screenshots) {
      if (screenshot.filename && screenshot.filename.length > 0) {
        try {
          const filepath = join('./output', 'screenshots', screenshot.filename);
          // Check if file exists before reading
          if (existsSync(filepath)) {
            const buffer = await readFile(filepath);
            buffers.push(buffer);
          } else {
            console.warn(`Screenshot file not found: ${screenshot.filename}`);
          }
        } catch (error) {
          console.warn(`Failed to load screenshot ${screenshot.filename}:`, error);
        }
      }
    }
    return buffers;
  }

  /**
   * Create fallback report when evaluation fails
   */
  private createFallbackReport(
    gameUrl: string,
    screenshots: ScreenshotInfo[],
    consoleErrors: string[],
    consoleWarnings: string[],
    executionTimeSeconds: number
  ): QAReport {
    const hasErrors = consoleErrors.length > 0;
    const hasScreenshots = screenshots.length > 0;

    return {
      status: hasErrors ? 'fail' : hasScreenshots ? 'partial' : 'error',
      playability_score: hasErrors ? 20 : hasScreenshots ? 50 : 0,
      issues: [
        {
          severity: hasErrors ? 'critical' : 'warning',
          description: hasErrors
            ? 'Game encountered errors during execution'
            : 'Evaluation system failure - manual review required',
          confidence: 0.7,
        },
      ],
      screenshots,
      timestamp: new Date().toISOString(),
      game_url: gameUrl,
      execution_time_seconds: executionTimeSeconds,
      metadata: {
        console_errors: consoleErrors,
        console_warnings: consoleWarnings,
      },
    };
  }
}

