/**
 * Operation Registry — single source of truth for all CLI operations.
 *
 * The REPL menu, help text, and command routing all read from this list.
 * Adding a new operation = adding one entry here + one command class.
 */

export interface Operation {
  /** Unique identifier for this operation. */
  id: string;
  /** Human-readable label for menus and help. */
  label: string;
  /** Short description of what this operation does. */
  description: string;
  /** The oclif command name that implements this operation. */
  command: string;
  /** Keyboard shortcut number for REPL menu (1-based). */
  shortcut: number;
  /** Media category for grouping in menus. */
  category: 'create' | 'edit' | 'utility';
}

export const OPERATIONS: readonly Operation[] = [
  // ── Create (shortcuts 1–11) ──────────────────────────────────────────
  {
    id: 'generate',
    label: 'Generate',
    description: 'Generate with any model — universal entry',
    command: 'generate',
    shortcut: 1,
    category: 'create',
  },
  {
    id: 'image',
    label: 'Image',
    description: 'Generate an image from a text prompt',
    command: 'image',
    shortcut: 2,
    category: 'create',
  },
  {
    id: 'video',
    label: 'Video',
    description: 'Generate a video from a text prompt',
    command: 'video',
    shortcut: 3,
    category: 'create',
  },
  {
    id: 'image-to-video',
    label: 'Image to Video',
    description: 'Animate an image into a video',
    command: 'image-to-video',
    shortcut: 4,
    category: 'create',
  },
  {
    id: 'music',
    label: 'Music',
    description: 'Generate music from a text prompt',
    command: 'music',
    shortcut: 5,
    category: 'create',
  },
  {
    id: 'sfx',
    label: 'Sound Effects',
    description: 'Generate sound effects from a text prompt',
    command: 'sfx',
    shortcut: 6,
    category: 'create',
  },
  {
    id: 'text-to-speech',
    label: 'Text to Speech',
    description: 'Synthesize spoken audio from text',
    command: 'text-to-speech',
    shortcut: 7,
    category: 'create',
  },
  {
    id: 'audio-from-text',
    label: 'Audio from Text',
    description: 'Generate generic audio from a text prompt',
    command: 'audio-from-text',
    shortcut: 8,
    category: 'create',
  },
  {
    id: 'talking-photo',
    label: 'Talking Photo',
    description: 'Animate a photo with a voice track',
    command: 'talking-photo',
    shortcut: 9,
    category: 'create',
  },
  {
    id: 'character',
    label: 'Character',
    description: 'Generate consistent-character images',
    command: 'character',
    shortcut: 10,
    category: 'create',
  },
  {
    id: 'multi-image',
    label: 'Multi-Image',
    description: 'Combine multiple images into one generation',
    command: 'multi-image',
    shortcut: 11,
    category: 'create',
  },

  // ── Edit (shortcuts 12–19) ───────────────────────────────────────────
  {
    id: 'remove-bg',
    label: 'Remove Background',
    description: 'Remove the background from an image',
    command: 'remove-bg',
    shortcut: 12,
    category: 'edit',
  },
  {
    id: 'change-bg',
    label: 'Change Background',
    description: 'Replace the background with a prompt',
    command: 'change-bg',
    shortcut: 13,
    category: 'edit',
  },
  {
    id: 'enhance',
    label: 'Enhance',
    description: 'Restore or improve an image at the same size',
    command: 'enhance',
    shortcut: 14,
    category: 'edit',
  },
  {
    id: 'upscale',
    label: 'Upscale',
    description: 'Increase the resolution of an image',
    command: 'upscale',
    shortcut: 15,
    category: 'edit',
  },
  {
    id: 'edit-image',
    label: 'Edit Image',
    description: 'Edit an image with a natural-language prompt',
    command: 'edit-image',
    shortcut: 16,
    category: 'edit',
  },
  {
    id: 'voice-clone',
    label: 'Voice Clone',
    description: 'Convert speech to another voice',
    command: 'voice-clone',
    shortcut: 17,
    category: 'edit',
  },
  {
    id: 'video-edit',
    label: 'Video Edit',
    description: 'Transform a video (v2v)',
    command: 'video-edit',
    shortcut: 18,
    category: 'edit',
  },
  {
    id: 'video-audio',
    label: 'Video → Audio',
    description: 'Generate an audio track for a video',
    command: 'video-audio',
    shortcut: 19,
    category: 'edit',
  },
  {
    id: 'extend',
    label: 'Extend',
    description: 'Extend a video by additional seconds',
    command: 'extend',
    shortcut: 20,
    category: 'edit',
  },

  // ── Utility (shortcuts 21+) ──────────────────────────────────────────
  {
    id: 'vectorize',
    label: 'Vectorize',
    description: 'Convert a raster image to SVG',
    command: 'vectorize',
    shortcut: 21,
    category: 'utility',
  },
];

export function getOperationById(id: string): Operation | undefined {
  return OPERATIONS.find((op) => op.id === id);
}

export function getOperationByCommand(command: string): Operation | undefined {
  return OPERATIONS.find((op) => op.command === command);
}

export function getOperationsByCategory(category: Operation['category']): readonly Operation[] {
  return OPERATIONS.filter((op) => op.category === category);
}
