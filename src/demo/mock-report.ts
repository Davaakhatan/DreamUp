/**
 * Mock report generator for demo purposes
 * Creates sample test reports to showcase the dashboard
 */

import type { QAReport } from '../types/report.js';

export function generateMockReport(gameUrl: string): QAReport {
  return {
    status: 'pass',
    playability_score: 85,
    issues: [
      {
        severity: 'info',
        description: 'Game loaded successfully with responsive controls',
        confidence: 0.9,
      },
    ],
    screenshots: [
      {
        filename: 'demo-screenshot-1.png',
        timestamp: new Date().toISOString(),
        label: 'initial-load',
      },
      {
        filename: 'demo-screenshot-2.png',
        timestamp: new Date().toISOString(),
        label: 'gameplay',
      },
      {
        filename: 'demo-screenshot-3.png',
        timestamp: new Date().toISOString(),
        label: 'final-state',
      },
    ],
    timestamp: new Date().toISOString(),
    game_url: gameUrl,
    execution_time_seconds: 12.5,
    metadata: {
      console_errors: [],
      console_warnings: [],
      load_time_ms: 2500,
    },
  };
}

