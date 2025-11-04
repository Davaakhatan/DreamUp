/**
 * Types for browser automation interactions
 */

export interface BrowserSession {
  sessionId: string;
  close: () => Promise<void>;
  evaluate: (script: string) => Promise<any>;
  navigate: (url: string) => Promise<void>;
  screenshot: () => Promise<Buffer>;
  click: (selector: string) => Promise<void>;
  clickByText: (text: string, options?: { exact?: boolean }) => Promise<boolean>;
  keypress: (key: string) => Promise<void>;
  wait: (ms: number) => Promise<void>;
  getConsoleLogs: () => Promise<ConsoleLog[]>;
  switchToIframe?: (selector?: string) => Promise<boolean>;
  switchToMainFrame?: () => Promise<void>;
  clickAt?: (x: number, y: number) => Promise<boolean>;
}

export interface ConsoleLog {
  level: 'log' | 'warn' | 'error' | 'info';
  message: string;
  timestamp: number;
}

export interface BrowserProvider {
  createSession(options?: BrowserOptions): Promise<BrowserSession>;
}

export interface BrowserOptions {
  headless?: boolean;
  width?: number;
  height?: number;
  timeout?: number;
}

