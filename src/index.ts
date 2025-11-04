/**
 * DreamUp Browser Game QA Pipeline
 * Main entry point for programmatic usage
 */

export { QAAgent } from './agent/qa-agent.js';
export { BrowserbaseProvider } from './browser/browserbase-provider.js';
export { EvidenceCapture } from './agent/evidence-capture.js';
export { Evaluator } from './agent/evaluator.js';
export { InteractionEngine } from './agent/interaction-engine.js';
export { loadConfig, defaultConfig } from './config/config-loader.js';
export { parseInputSchema } from './utils/input-schema-parser.js';
export type { QAConfig, ActionConfig, TimeoutConfig } from './types/config.js';
export type { QAReport, Issue, ScreenshotInfo } from './types/report.js';
export type { BrowserSession, BrowserProvider } from './types/browser.js';
export type { InputSchema, ParsedInputSchema, ActionDefinition, Axis1DDefinition, Axis2DDefinition } from './types/input-schema.js';

