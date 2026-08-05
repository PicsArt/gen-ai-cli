/**
 * Input Resolution entry point — picks interactive or scripted resolver.
 *
 * Mode is determined once:
 * - TTY + no --silent + no --no-input → interactive
 * - Otherwise → scripted (fail fast on missing inputs)
 */

import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { findModel } from '@picsart/ai-sdk';
import type { FlowSpec } from '#flows';
import { FileError } from '#infra/errors/file.ts';
import { resolveInteractive } from '#pipeline/01-wizard-runner/resolver.ts';
import type { CliDeps } from '#root/deps.ts';
import type { ResolvedInputs } from '#root/types.ts';
import { isInteractiveMode } from '#root/types.ts';
import { getAuthenticatedFetch } from '#services/client.ts';
import { resolveAllFiles } from '#services/file-upload.ts';
import { resolveScripted } from './scripted/resolver.ts';
import { finalizeTextAnalysisInputs } from './text-analysis.ts';
import { deriveTopLevelPromptFromMulti, validateFileSlotLimits } from './types.ts';

// Re-exported for the scripted resolver's tests and for callers that have
// always reached for it here; the implementation lives in `types.ts` so the
// dispatcher and the scripted resolver can share it without a cycle.
export { deriveTopLevelPromptFromMulti };

/**
 * Resolve all inputs for a flow.
 * Automatically picks interactive or scripted mode based on flags and TTY.
 * Returns ResolvedInputs or null (if the interactive user cancelled).
 *
 * Pre-resolution normalization (universal across all operations):
 *   1. If `--prompt-file` is set and `--prompt` is not, read the file
 *      into `flags.prompt`.
 *   2. If `--prompt` is still unset and stdin is piped (not a TTY),
 *      read stdin into `flags.prompt`.
 *
 * Per Decision 2: file uploads happen here, after the resolver returns.
 * By the time `ResolvedInputs` is handed to the executor, every entry in
 * `files` is already an upload URL (local paths replaced).
 */
export async function resolveInputs(
  flow: FlowSpec,
  flags: Record<string, unknown>,
  deps: CliDeps,
): Promise<ResolvedInputs | null> {
  const normalized = await normalizePromptInput(flags);

  // Auto-scripted: when the user provided everything on the command line
  // (model + prompt + every required file), skip the interactive wizard
  // and the confirm step entirely. They asked us to run; just run.
  const useScripted = !isInteractiveMode(deps.flags) || flagsFullySpecifyInputs(flow, normalized);

  let inputs = useScripted
    ? await resolveScripted(flow, normalized, deps)
    : await resolveInteractive(flow, normalized, deps);

  if (!inputs) return null;

  // If the user filled in a richer prompt source (Kling V3's multiPrompt
  // and similar list-of-shots descriptors) but never set a top-level
  // prompt, derive it from the first item. The SDK still wants both
  // `prompt` and `multi_prompt[]` for Kling — and scripted users who
  // typed only `--multi-prompt-prompt` (not `--prompt`) would otherwise
  // hit an API-side "missing prompt" error.
  const derived = deriveTopLevelPromptFromMulti(inputs.params);
  if (derived !== undefined) inputs.params.prompt = derived;

  // Text/LLM models (image/video → text): default the prompt, require a
  // media input, and route video requests to a video-capable model.
  if (inputs.model.mode === 'text') {
    inputs = finalizeTextAnalysisInputs(inputs, normalized, flow);
  }

  // Fail fast on too-many-files-per-slot before uploading anything.
  validateFileSlotLimits(inputs.model, inputs.files);

  // Upload local files → URLs before handing off to execution.
  if (hasAnyFile(inputs.files)) {
    const { creds } = await getAuthenticatedFetch();
    inputs.files = await resolveAllFiles(inputs.files, { token: creds.token, uid: creds.uid });
  }

  return inputs;
}

/**
 * Returns true when CLI flags fully specify the operation — model is set,
 * every flow-level required input is satisfied, and (for text-primary
 * models) a prompt is present. The dispatcher uses this to route past the
 * interactive wizard so an explicit one-shot command runs without a confirm
 * step. Returns false on any missing piece; the wizard will fill the gaps.
 */
export function flagsFullySpecifyInputs(flow: FlowSpec, flags: Record<string, unknown>): boolean {
  const modelFlag = (flags.model as string | undefined) ?? flow.defaultModel;
  if (!modelFlag) return false;

  const model = findModel(modelFlag);
  if (!model || !flow.modelFilter(model)) return false;

  for (const input of flow.requiredInputs) {
    switch (input) {
      case 'prompt': {
        if (hasPromptIntent(flags)) break;
        return false;
      }
      case 'image': {
        const imgs = flags.image as string[] | string | undefined;
        const hasImg = Array.isArray(imgs) ? imgs.length > 0 : Boolean(imgs);
        // --start-frame counts: some i2v models (wan-2.7-i2v, luma-ray-flash-2)
        // expose `startFrame` instead of `imageUrls`. Either flag satisfies
        // the flow-level "image" requirement.
        if (!hasImg && !flags['start-frame']) return false;
        break;
      }
      case 'video':
        if (!flags.video) return false;
        break;
      case 'audio':
        if (!flags.audio) return false;
        break;
    }
  }

  // Text-primary models always benefit from a prompt even when not strictly
  // required by the flow. Without one, the wizard would still ask, so leave
  // routing to interactive.
  if (model.inputType.startsWith('t') && !hasPromptIntent(flags)) return false;

  return true;
}

/**
 * Whether the user supplied a prompt — either directly via `--prompt` or
 * indirectly through a richer prompt source like `--multi-prompt-prompt`
 * (Kling V3 multi-shot). The dispatcher derives the top-level `prompt`
 * from `multiPrompt[0].prompt` after resolution, so either input fully
 * satisfies the prompt requirement.
 */
function hasPromptIntent(flags: Record<string, unknown>): boolean {
  if (typeof flags.prompt === 'string' && flags.prompt.trim().length > 0) return true;
  const mpp = flags['multi-prompt-prompt'];
  if (Array.isArray(mpp) && mpp.some((s) => typeof s === 'string' && s.trim().length > 0)) return true;
  if (typeof mpp === 'string' && mpp.trim().length > 0) return true;
  return false;
}

/**
 * Resolve alternative prompt sources before resolution begins. Returns
 * a NEW flags object with `prompt` populated from the highest-priority
 * source available (input is not mutated).
 *
 * Precedence (highest first):
 *   --prompt (explicit) > --prompt-file > piped stdin
 *
 * Exposed for tests; the dispatcher always calls it.
 */
export async function normalizePromptInput(flags: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (typeof flags.prompt === 'string' && flags.prompt.trim().length > 0) return flags;

  const promptFile = flags['prompt-file'];
  if (typeof promptFile === 'string' && promptFile.length > 0) {
    let prompt: string;
    try {
      prompt = readFileSync(promptFile, 'utf-8').trim();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new FileError(promptFile, `Could not read --prompt-file: ${msg}`);
    }
    return { ...flags, prompt };
  }

  if (!process.stdin.isTTY) {
    const piped = await readStdinText();
    if (piped.length > 0) return { ...flags, prompt: piped };
  }

  return flags;
}

function readStdinText(): Promise<string> {
  return new Promise((resolve) => {
    const lines: string[] = [];
    const rl = createInterface({ input: process.stdin });
    rl.on('line', (line) => lines.push(line));
    rl.on('close', () => resolve(lines.join('\n').trim()));
  });
}

function hasAnyFile(files: ResolvedInputs['files']): boolean {
  return Boolean(files.images?.length || files.startFrame || files.endFrame || files.video || files.audio);
}
