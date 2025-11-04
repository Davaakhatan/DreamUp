/**
 * Utility to parse and normalize input schema for use in QA agent
 */

import type {
  InputSchema,
  ParsedInputSchema,
  ActionDefinition,
  Axis1DDefinition,
  Axis2DDefinition,
} from '../types/input-schema.js';

/**
 * Parse input schema into a normalized format for easier use
 */
export function parseInputSchema(schema: InputSchema): ParsedInputSchema {
  const actionToKey = new Map<string, string[]>();
  const axisToKeys = new Map<string, { negative?: string[]; positive?: string[] }>();
  const allKeys = new Set<string>();

  // Parse actions
  if (schema.actions) {
    for (const action of schema.actions) {
      const keys: string[] = [];
      for (const binding of action.bindings) {
        if (binding.type === 'key') {
          keys.push(binding.input);
          allKeys.add(binding.input);
        }
      }
      if (keys.length > 0) {
        actionToKey.set(action.name, keys);
      }
    }
  }

  // Parse 1D axes
  if (schema.axes1D) {
    for (const axis of schema.axes1D) {
      const negativeKeys: string[] = [];
      const positiveKeys: string[] = [];

      for (const binding of axis.bindings) {
        if (binding.type === 'key') {
          if (binding.direction === 'negative') {
            negativeKeys.push(binding.input);
          } else if (binding.direction === 'positive') {
            positiveKeys.push(binding.input);
          } else {
            // If no direction specified, assume it's a bidirectional key
            negativeKeys.push(binding.input);
            positiveKeys.push(binding.input);
          }
          allKeys.add(binding.input);
        }
      }

      if (negativeKeys.length > 0 || positiveKeys.length > 0) {
        axisToKeys.set(axis.name, {
          negative: negativeKeys.length > 0 ? negativeKeys : undefined,
          positive: positiveKeys.length > 0 ? positiveKeys : undefined,
        });
      }
    }
  }

  // Parse 2D axes
  if (schema.axes2D) {
    for (const axis of schema.axes2D) {
      const negativeXKeys: string[] = [];
      const positiveXKeys: string[] = [];
      const negativeYKeys: string[] = [];
      const positiveYKeys: string[] = [];

      for (const binding of axis.bindings) {
        if (binding.type === 'key') {
          // For 2D axes, we need to infer direction from common patterns
          const input = binding.input.toLowerCase();
          
          // Common patterns: WASD, arrow keys
          if (input === 'a' || input === 'arrowleft') {
            negativeXKeys.push(binding.input);
          } else if (input === 'd' || input === 'arrowright') {
            positiveXKeys.push(binding.input);
          } else if (input === 'w' || input === 'arrowup') {
            negativeYKeys.push(binding.input);
          } else if (input === 's' || input === 'arrowdown') {
            positiveYKeys.push(binding.input);
          }

          allKeys.add(binding.input);
        }
      }

      // Store as X and Y components
      if (negativeXKeys.length > 0 || positiveXKeys.length > 0) {
        axisToKeys.set(`${axis.name}-X`, {
          negative: negativeXKeys.length > 0 ? negativeXKeys : undefined,
          positive: positiveXKeys.length > 0 ? positiveXKeys : undefined,
        });
      }
      if (negativeYKeys.length > 0 || positiveYKeys.length > 0) {
        axisToKeys.set(`${axis.name}-Y`, {
          negative: negativeYKeys.length > 0 ? negativeYKeys : undefined,
          positive: positiveYKeys.length > 0 ? positiveYKeys : undefined,
        });
      }
    }
  }

  return {
    actionToKey,
    axisToKeys,
    allKeys: Array.from(allKeys),
    metadata: {
      gameId: schema.gameId,
      gameName: schema.gameName,
      notes: schema.notes,
    },
  };
}

/**
 * Get primary key for an action (first binding)
 */
export function getActionKey(
  parsedSchema: ParsedInputSchema,
  actionName: string
): string | null {
  const keys = parsedSchema.actionToKey.get(actionName);
  return keys && keys.length > 0 ? keys[0] : null;
}

/**
 * Get all keys for an action
 */
export function getActionKeys(
  parsedSchema: ParsedInputSchema,
  actionName: string
): string[] {
  return parsedSchema.actionToKey.get(actionName) || [];
}

/**
 * Get keys for an axis direction
 */
export function getAxisKeys(
  parsedSchema: ParsedInputSchema,
  axisName: string,
  direction: 'negative' | 'positive' | 'both' = 'both'
): string[] {
  const axisData = parsedSchema.axisToKeys.get(axisName);
  if (!axisData) return [];

  const keys: string[] = [];
  if (direction === 'negative' || direction === 'both') {
    if (axisData.negative) keys.push(...axisData.negative);
  }
  if (direction === 'positive' || direction === 'both') {
    if (axisData.positive) keys.push(...axisData.positive);
  }
  return keys;
}

/**
 * Check if a key is part of the input schema
 */
export function isKeyInSchema(parsedSchema: ParsedInputSchema, key: string): boolean {
  return parsedSchema.allKeys.includes(key);
}

