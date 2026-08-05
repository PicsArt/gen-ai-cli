/**
 * Parameter prompting and interactive UX for the generate command.
 * File-input prompting lives in prompt-input.ts (extracted for file size).
 */

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { DriveMediaItem, GenerationContext, ModelDefinition } from '@picsart/ai-sdk';
import { Models } from '@picsart/ai-sdk';
import { filterCatalog } from '#flows';
import { getOutput } from '#infra/ui-core/output.ts';
import { AUDIO_EXTS, VIDEO_EXTS } from '#infra/utils/media-types.ts';
import { generateWizardStepsFromCatalog, getCatalog, type WizardStep as SchemaStep } from '#param-surface';
import type { NavResult, StepResult, WizardStep } from '#pipeline/01-wizard-runner/wizard-state.ts';
import { BACK, CANCEL, runWizard } from '#pipeline/01-wizard-runner/wizard-state.ts';
import { listDriveMedia } from '#services/drive.ts';
import { askWithNav, confirmWithNav, selectWithNav } from '../nav.ts';
import { PAGE_SIZE } from './prompt-files.ts';
import { type InputSource, promptFileInput, promptImageInputs } from './prompt-input.ts';

export type { InputSource };

/** Pre-fetched Drive media, keyed by type. Computed outside the prompt layer. */
export interface DrivePrefetch {
  images?: DriveMediaItem[];
  videos?: DriveMediaItem[];
  audios?: DriveMediaItem[];
}

export async function pickOption<T extends string | number>(
  label: string,
  options: T[],
  defaultVal?: T,
): Promise<NavResult<T>> {
  if (options.length === 0) return defaultVal as T;

  const choices = options.map((opt) => ({
    name: String(opt),
    value: opt,
  }));

  return selectWithNav<T>({ message: label, choices, default: defaultVal, pageSize: PAGE_SIZE });
}

/** Open $EDITOR for multi-line prompt editing. Returns the text or null. */
export function openEditorForPrompt(): string | null {
  const editor = process.env.EDITOR ?? process.env.VISUAL ?? 'vi';
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-ai-prompt-'));
  const tmpFile = path.join(tmpDir, 'prompt.txt');
  fs.writeFileSync(tmpFile, '');
  try {
    const parts = editor.split(/\s+/);
    const result = spawnSync(parts[0], [...parts.slice(1), tmpFile], { stdio: 'inherit' });
    if (result.status !== 0) return null;
    try {
      const content = fs.readFileSync(tmpFile, 'utf-8').trim();
      return content || null;
    } catch {
      getOutput().info('Could not read editor output');
      return null;
    }
  } finally {
    try {
      fs.unlinkSync(tmpFile);
      fs.rmdirSync(tmpDir);
    } catch {
      /* ignore ENOENT */
    }
  }
}

/**
 * Prompt for every parameter the chosen model declares.
 *
 * The schema for "what to ask" comes from Param Surface — we filter the
 * universal catalog to the chosen model and let `wizard-schema` emit a
 * declarative `WizardStep[]` we walk. Adding a new SDK paramConfig
 * descriptor automatically surfaces here; no edits needed.
 *
 * Skipped by design:
 *   - `kind: 'file'`         → owned by the file-step (uploads, drive picker)
 *   - `key === 'prompt'`     → owned by the prompt-step (rich command box)
 *   - keys already present in `ctx` (prefilled from flags)
 *
 * Returns the answers as a `Partial<GenerationContext>`. Sub-wizard
 * cancellation propagates as `BACK`; `runWizard` handles `CANCEL`.
 */
export async function promptForParams(
  model: ModelDefinition,
  ctx: Readonly<Partial<GenerationContext>>,
): Promise<StepResult<Partial<GenerationContext>>> {
  const schemaSteps = generateWizardStepsFromCatalog(filterCatalog(getCatalog(), new Set([model.id])));

  const steps: WizardStep[] = [];
  for (const s of schemaSteps) {
    if (s.kind === 'file') continue;
    if (s.key === 'prompt') continue;
    if ((ctx as Record<string, unknown>)[s.key] != null) continue;
    const step = buildRunnerStep(s);
    if (step !== undefined) steps.push(step);
  }

  if (steps.length === 0) return {};

  const result = await runWizard(steps);
  if (result === null) return BACK;

  const updates: Partial<GenerationContext> = {};
  for (const [key, val] of Object.entries(result)) {
    if (val !== undefined) (updates as Record<string, unknown>)[key] = val;
  }
  return updates;
}

/* ─────────────────────────────────────────────────────────────────────── */
/*  Schema step → runner step (kind dispatcher)                           */
/* ─────────────────────────────────────────────────────────────────────── */

function buildRunnerStep(s: SchemaStep): WizardStep | undefined {
  switch (s.kind) {
    case 'select': {
      if (s.choices.length === 0) return undefined;
      const ids = s.choices.map((c) => c.id) as (string | number)[];
      const def = s.default as string | number | undefined;
      return { id: s.key, run: () => pickOption(s.label, ids, def) };
    }

    case 'confirm':
      return { id: s.key, run: () => confirmWithNav({ message: s.label, default: s.default }) };

    case 'text':
      return {
        id: s.key,
        run: async () => {
          const val = await askWithNav(s.label);
          return val || undefined;
        },
      };

    case 'number':
      return { id: s.key, run: () => askNumeric(s.label, s.min, s.max, s.default) };

    case 'object':
      return { id: s.key, run: () => runObjectStep(s) };

    case 'file':
      return undefined; // owned by the file-step
  }
}

async function askNumeric(
  label: string,
  min: number,
  max: number,
  defaultVal?: number,
): Promise<NavResult<number | undefined>> {
  const hint = `${min}–${max}${defaultVal != null ? `, default ${defaultVal}` : ''}`;
  const val = await askWithNav(`${label} (${hint})`);
  if (!val) return defaultVal;
  const num = Number(val);
  if (Number.isNaN(num) || num < min || num > max) {
    getOutput().info(`Invalid: must be ${min}–${max}.${defaultVal != null ? ` Using default ${defaultVal}.` : ''}`);
    return defaultVal;
  }
  return num;
}

/**
 * Object descriptor → optional opt-in gate + "how many?" + per-item sub-wizard.
 *
 * Optional descriptors (no required flag set) get a yes/no gate FIRST —
 * "Add Multi-Shot Prompts? [N]" with default no. Users who don't want
 * the feature press Enter and the entire sub-wizard is skipped.
 *
 * Required descriptors skip the gate and go straight to "How many?".
 *
 * Skip mechanics for the count prompt:
 *   - blank input or `0`         → []        (optional) / undefined (required)
 *   - 1–arrayMax                 → loop N times
 *   - out-of-range / NaN         → clamp to nearest valid (1 or max)
 *
 * Subfield order comes from `wizard-schema`, where required subfields
 * (no default) are emitted first and optional ones (has default) last.
 * So `multiPrompt` asks `prompt` → `duration` → `index` instead of the
 * raw SDK field order.
 *
 * Cancelling the sub-wizard bubbles up as BACK to the outer wizard.
 */
async function runObjectStep(
  s: Extract<SchemaStep, { kind: 'object' }>,
): Promise<NavResult<Record<string, unknown>[] | undefined>> {
  // Optional opt-in gate — answers the user's "why am I being forced
  // to provide voice references for a simple video?" complaint.
  if (s.required !== true) {
    const useIt = await confirmWithNav({ message: `Add ${s.label}? (optional)`, default: false });
    if (useIt === BACK || useIt === CANCEL) return useIt;
    if (!useIt) return [];
  }

  const max = s.arrayMax ?? 1;
  const hint = s.required ? `(1–${max})` : `(1–${max}, blank to skip)`;
  const countAnswer = (await askWithNav(`How many ${s.label}? ${hint}`)).trim();

  if (countAnswer === '' || countAnswer === '0') return s.required ? undefined : [];
  const parsed = Number(countAnswer);
  if (Number.isNaN(parsed)) return s.required ? undefined : [];
  const count = Math.max(1, Math.min(max, parsed));

  const items: Record<string, unknown>[] = [];
  for (let i = 0; i < count; i++) {
    const subRunnerSteps: WizardStep[] = [];
    for (const sub of s.fields) {
      const ss = buildRunnerStep(sub);
      if (ss !== undefined) subRunnerSteps.push(ss);
    }
    if (subRunnerSteps.length === 0) continue;

    getOutput().info(`\n${s.label} ${i + 1}/${count}`);
    const subAnswers = await runWizard(subRunnerSteps);
    if (subAnswers === null) return BACK;
    items.push(subAnswers);
  }
  return items;
}

/** Pre-fetch Drive media for all input types the model supports. */
export async function prefetchDriveMedia(model: ModelDefinition): Promise<DrivePrefetch> {
  const prefetch: DrivePrefetch = {};
  const imgParam = Models.getFileParam(model.id, 'imageUrls');
  const vidParam = Models.getFileParam(model.id, 'videoUrl');
  const audParam = Models.getFileParam(model.id, 'audioUrl');

  try {
    const [images, videos, audios] = await Promise.all([
      imgParam ? listDriveMedia('image') : undefined,
      vidParam ? listDriveMedia('video') : undefined,
      audParam ? listDriveMedia('audio') : undefined,
    ]);
    if (images) prefetch.images = images;
    if (videos) prefetch.videos = videos;
    if (audios) prefetch.audios = audios;
  } catch {
    getOutput().info('Could not load Drive files — showing local files only');
  }

  return prefetch;
}

async function promptSingleMediaInput(
  type: 'video' | 'audio',
  model: ModelDefinition,
  ctx: Readonly<Partial<GenerationContext>>,
  drive?: DrivePrefetch,
): Promise<Partial<GenerationContext>> {
  const inputConfig = Models.getFileParam(model.id, type === 'video' ? 'videoUrl' : 'audioUrl');
  if (!inputConfig) return {};

  const existing = type === 'video' ? ctx.videoUrl : ctx.audioUrl;
  if (existing) return {};

  const exts = type === 'video' ? VIDEO_EXTS : AUDIO_EXTS;
  const driveItems = type === 'video' ? drive?.videos : drive?.audios;
  const label = inputConfig.required
    ? `${type.charAt(0).toUpperCase() + type.slice(1)} (required)`
    : `${type.charAt(0).toUpperCase() + type.slice(1)} (optional)`;

  const files = await promptFileInput({
    label,
    required: !!inputConfig.required,
    exts,
    mediaType: type,
    drive: drive ? { items: driveItems } : undefined,
  });

  if (!files[0]) return {};
  return type === 'video' ? { videoUrl: files[0] } : { audioUrl: files[0] };
}

export async function promptForInputFiles(
  model: ModelDefinition,
  ctx: Readonly<Partial<GenerationContext>>,
  drive?: DrivePrefetch,
  hints?: { promptProvided?: boolean },
): Promise<Partial<GenerationContext>> {
  const imgP = Models.getFileParam(model.id, 'imageUrls');
  const sfP = Models.getFileParam(model.id, 'startFrame');
  const efP = Models.getFileParam(model.id, 'endFrame');
  const vidP = Models.getFileParam(model.id, 'videoUrl');
  const audP = Models.getFileParam(model.id, 'audioUrl');
  // Treat startFrame as an image input for prompting purposes
  const effectiveImgP = imgP ?? sfP;
  if (!effectiveImgP && !vidP && !audP) return {};

  const hasOptionalFiles =
    (effectiveImgP && !effectiveImgP.required) || (vidP && !vidP.required) || (audP && !audP.required);
  const hasRequiredFiles = effectiveImgP?.required || vidP?.required || audP?.required;
  const isTextPrimary = model.inputType.startsWith('t');
  const ctxHasAnyFile = Boolean(ctx.imageUrls?.length || ctx.startFrame || ctx.videoUrl || ctx.audioUrl);

  // If model has both text-only and file-input modes, let user choose —
  // unless intent is already unambiguous from CLI flags (--prompt given
  // with no file flags → text; any file flag already in ctx → files).
  let useFiles = !isTextPrimary || hasRequiredFiles;
  if (ctxHasAnyFile) useFiles = true;
  if (isTextPrimary && hasOptionalFiles && !hasRequiredFiles && !ctxHasAnyFile && !hints?.promptProvided) {
    const modeLabel = model.mode === 'video' ? 'video' : model.mode === 'audio' ? 'audio' : 'image';
    const choices: { name: string; value: 'text' | 'file' }[] = [
      { name: `Describe with text only (text → ${modeLabel})`, value: 'text' },
    ];
    if (effectiveImgP) choices.push({ name: `Start from an image (image → ${modeLabel})`, value: 'file' });
    if (vidP && !effectiveImgP) choices.push({ name: `Start from a video (video → ${modeLabel})`, value: 'file' });

    // Only ask if there are meaningful options
    if (choices.length > 1) {
      const answer = await selectWithNav<'text' | 'file'>({
        message: 'How do you want to use this model?',
        choices,
      });
      if (answer === BACK || answer === CANCEL) return {};
      useFiles = answer === 'file';
    }
  }

  if (!useFiles) return {};

  const updates: Partial<GenerationContext> = {};

  // Image input: models use either imageUrls or startFrame (+ optional endFrame)
  const usesStartFrame = !imgP && !!sfP;
  if (effectiveImgP && (!ctx.imageUrls || ctx.imageUrls.length === 0) && !ctx.startFrame) {
    const label = effectiveImgP.label || (usesStartFrame ? 'Start Frame' : 'Image');
    const values = await promptImageInputs(
      label,
      !!effectiveImgP.required,
      usesStartFrame ? 1 : effectiveImgP.max,
      drive,
    );
    if (values.length > 0) {
      if (usesStartFrame) {
        updates.startFrame = values[0];
      } else {
        updates.imageUrls = values;
      }
    }
  }

  // End frame (optional second image for models like Luma)
  if (efP && !ctx.endFrame) {
    const efValues = await promptImageInputs(efP.label || 'End Frame', !!efP.required, 1, drive);
    if (efValues.length > 0) updates.endFrame = efValues[0];
  }

  if (vidP) {
    Object.assign(updates, await promptSingleMediaInput('video', model, ctx, drive));
  }
  if (audP) {
    Object.assign(updates, await promptSingleMediaInput('audio', model, ctx, drive));
  }

  return updates;
}

export function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY);
}
