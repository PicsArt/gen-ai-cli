/**
 * Shared types for the CLI layered pipeline architecture.
 *
 * These types define the contracts between layers:
 * - ResolvedInputs: output of Input Resolution → input to Execution
 * - ExecutionResult: output of Execution → input to Output
 * - ProgressCallback: Execution → Command (for rendering progress)
 * - OperationConfig: Command → Input Resolution (what inputs to collect)
 * - OutputConfig: Command → Output (how to handle results)
 */
import type { ModelDefinition } from '@picsart/ai-sdk';

/* ── Input Resolution → Execution ────────────────────────────── */

export interface ResolvedInputs {
  model: ModelDefinition;
  /** Generation params — matches SDK `GenerationContext` shape, INCLUDING `prompt`. */
  params: Record<string, unknown>;
  files: {
    images?: string[];
    startFrame?: string;
    endFrame?: string;
    video?: string;
    audio?: string;
    /** Array of reference videos (-> SDK `videoUrls`). Populated by `--video-urls`. */
    videos?: string[];
    /** Array of reference audios (-> SDK `audioUrls`). Populated by `--audio-urls`. */
    audios?: string[];
    /** Static-mask image for Kling V3 I2V motion brush. Populated by `--static-mask`. */
    staticMask?: string;
    /** Scene reference image for Kling multi-image-to-image. Populated by `--scene-image`. */
    sceneImage?: string;
    /** Style reference image for Kling multi-image-to-image. Populated by `--style-image`. */
    styleImage?: string;
  };
}

/* ── Execution → Output ──────────────────────────────────────── */

export interface ExecutionResult {
  status: 'completed' | 'failed' | 'cancelled' | 'timeout';
  url?: string;
  /**
   * Generated text — set only by text/LLM models (`mode === 'text'`),
   * which return a string instead of a media URL. When present, the
   * output layer prints it and skips download / Drive save.
   */
  text?: string;
  /**
   * One entry per result item. `exploreImageId` is populated by multi-result
   * models that tag each output with a server-side ID — currently Recraft
   * Explore. The ID is the value to feed into a follow-up call's
   * `--source-image-id` flag (e.g. `recraft-explore-similar`).
   */
  results: { url: string; type: string; exploreImageId?: string }[];
  model: ModelDefinition;
  params: Record<string, unknown>;
  durationMs: number;
  taskId?: string;
  error?: string;
}

/* ── Execution progress ──────────────────────────────────────── */

export interface ProgressInfo {
  percent?: number;
  status: string;
  elapsed: number;
}

export type ProgressCallback = (progress: ProgressInfo) => void;

/* ── Command → Input Resolution ──────────────────────────────── */

// Pipeline functions accept `FlowSpec` from `#flows` directly.
// `OperationConfig` was the legacy adapter type — removed.

/* ── Command → Output ────────────────────────────────────────── */

export interface OutputConfig {
  download?: string;
  driveSave: boolean;
  driveFolder: string;
  open: boolean;
  clipboard: boolean;
  bell: boolean;
  notify: boolean;
  jsonMode: boolean;
  quietMode: boolean;
  plainMode: boolean;
}

/* ── Mode detection ──────────────────────────────────────────── */

export function isInteractiveMode(flags: { silent?: boolean; noInput?: boolean }): boolean {
  if (flags.silent || flags.noInput) return false;
  return Boolean(process.stdin.isTTY);
}
