/**
 * Input schema types for game control layout
 * Based on DreamUp game engine's input system architecture
 */

/**
 * Action binding - maps hardware inputs to a named action
 */
export interface ActionBinding {
  /** Hardware key/button identifier (e.g., ' ', 'w', '#btn-jump') */
  input: string;
  /** Type of input: 'key' | 'mouse' | 'virtual-button' */
  type: 'key' | 'mouse' | 'virtual-button';
}

/**
 * Axis binding - maps hardware inputs to an axis
 */
export interface AxisBinding {
  /** Hardware key/button identifier (e.g., 'a', 'ArrowLeft', '#dpad.dpad-left') */
  input: string;
  /** Type of input: 'key' | 'mouse' | 'virtual-button' | 'joystick' | 'dpad' */
  type: 'key' | 'mouse' | 'virtual-button' | 'joystick' | 'dpad';
  /** For 1D axes: 'negative' or 'positive' direction */
  direction?: 'negative' | 'positive';
}

/**
 * Action definition - discrete button event
 */
export interface ActionDefinition {
  /** Action name (e.g., 'Jump', 'Shoot', 'Pause') */
  name: string;
  /** Bindings that trigger this action */
  bindings: ActionBinding[];
  /** Description of what this action does */
  description?: string;
}

/**
 * 1D Axis definition - continuous value from -1 to 1
 */
export interface Axis1DDefinition {
  /** Axis name (e.g., 'MoveHorizontal', 'Zoom') */
  name: string;
  /** Bindings for negative and positive directions */
  bindings: AxisBinding[];
  /** Smoothing factor (0-1) */
  smoothing?: number;
  /** Description of what this axis controls */
  description?: string;
}

/**
 * 2D Axis definition - normalized vector {x, y}
 */
export interface Axis2DDefinition {
  /** Axis name (e.g., 'Move', 'Camera') */
  name: string;
  /** Bindings for the axis (WASD, arrow keys, joystick, etc.) */
  bindings: AxisBinding[];
  /** Smoothing factor (0-1) */
  smoothing?: number;
  /** Description of what this axis controls */
  description?: string;
}

/**
 * Complete input schema for a game
 */
export interface InputSchema {
  /** Game identifier or URL */
  gameId?: string;
  /** Game name */
  gameName?: string;
  /** List of discrete actions */
  actions?: ActionDefinition[];
  /** List of 1D axes */
  axes1D?: Axis1DDefinition[];
  /** List of 2D axes */
  axes2D?: Axis2DDefinition[];
  /** Additional notes about the control scheme */
  notes?: string;
}

/**
 * Parsed and normalized input schema for easier use
 */
export interface ParsedInputSchema {
  /** Map of action names to their primary key bindings */
  actionToKey: Map<string, string[]>;
  /** Map of axis names to their key bindings */
  axisToKeys: Map<string, { negative?: string[]; positive?: string[] }>;
  /** List of all keys used in the schema */
  allKeys: string[];
  /** Schema metadata */
  metadata: {
    gameId?: string;
    gameName?: string;
    notes?: string;
  };
}

