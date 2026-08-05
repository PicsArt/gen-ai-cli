/**
 * tool-id-match — small helper for flow predicates that need to
 * discriminate on `model.toolId` patterns.
 *
 * `toolId` is a `ToolIdMapping` from the SDK, which can be:
 *   - a flat string (e.g. `'image-to-image.picsart-sod'`)
 *   - a conditional object that maps a context value to nested mappings:
 *       `{ by: 'resolution', map: { '480p': '...', '1080p': '...' } }`
 *   - an on/off split: `{ by: 'audio', on: '...', off: '...' }`
 *
 * Flow predicates only care whether **any** possible resolution matches
 * a pattern (e.g. "is this an upscaler?"). `flattenToolIds` walks the
 * tree and returns every leaf string; `hasToolIdMatching` is the
 * convenience wrapper that runs a regex against the flat list.
 *
 * Pure functions. No deps inside the block.
 */
import type { ModelDefinition } from '@picsart/ai-sdk';

/**
 * `ToolIdMapping` isn't re-exported from `@picsart/ai-sdk`'s barrel,
 * so we derive it from `ModelDefinition['toolId']`. Same union, no
 * coupling to internal SDK paths.
 */
type ToolIdMapping = NonNullable<ModelDefinition['toolId']>;

export function flattenToolIds(mapping: ToolIdMapping | undefined): readonly string[] {
  if (mapping === undefined) return [];
  if (typeof mapping === 'string') return [mapping];

  const m = mapping as Exclude<ToolIdMapping, string>;
  if ('on' in m) return [...flattenToolIds(m.on), ...flattenToolIds(m.off)];
  if ('map' in m) return Object.values(m.map).flatMap(flattenToolIds);
  return [];
}

export function hasToolIdMatching(model: ModelDefinition, pattern: RegExp): boolean {
  return flattenToolIds(model.toolId).some((t) => pattern.test(t));
}
