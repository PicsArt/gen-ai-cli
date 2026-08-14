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
 * `previousValues` (edit mode — the confirm step's "Edit parameters" loop)
 * seeds each step's default with the user's PREVIOUS choice, so pressing
 * Enter through the wizard keeps every value instead of silently resetting
 * to descriptor defaults.
 *
 * Returns the answers as a `Partial<GenerationContext>`. Sub-wizard
 * cancellation propagates as `BACK`; `runWizard` handles `CANCEL`.
 */
export async function promptForParams(
  model: ModelDefinition,
  ctx: Readonly<Partial<GenerationContext>>,
  previousValues?: Record<string, unknown>,
): Promise<StepResult<Partial<GenerationContext>>> {
  const schemaSteps = generateWizardStepsFromCatalog(filterCatalog(getCatalog(), new Set([model.id])));

  const steps: WizardStep[] = [];
  for (const s of schemaSteps) {
    if (s.kind === 'file') continue;
    if (s.key === 'prompt') continue;
    if ((ctx as Record<string, unknown>)[s.key] != null) continue;
    const step = buildRunnerStep(s, previousValues?.[s.key]);
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

function buildRunnerStep(s: SchemaStep, previous?: unknown): WizardStep | undefined {
  switch (s.kind) {
    case 'select': {
      if (s.choices.length === 0) return undefined;
      const ids = s.choices.map((c) => c.id) as (string | number)[];
      const prev = previous as string | number | undefined;
      const def = prev !== undefined && ids.includes(prev) ? prev : (s.default as string | number | undefined);
      return { id: s.key, run: () => pickOption(s.label, ids, def) };
    }

    case 'confirm': {
      const def = typeof previous === 'boolean' ? previous : s.default;
      return { id: s.key, run: () => confirmWithNav({ message: s.label, default: def }) };
    }

    case 'text':
      // Blank answers resolve to undefined → the caller's merge keeps
      // whatever value (flag/previous) it already has for this key.
      return {
        id: s.key,
        run: async () => {
          const val = await askWithNav(s.label);
          return val || undefined;
        },
      };

    case 'catalog': {
      // Free-string id served by a platform catalog task (voiceId, videoId).
      // Ask as text; blank falls back to the previous value, then default.
      const fallback = previous !== undefined ? previous : s.default;
      return {
        id: s.key,
        run: async () => {
          const hint = fallback !== undefined ? ` (default ${fallback})` : '';
          const val = await askWithNav(`${s.label}${hint}`);
          return val || fallback;
        },
      };
    }

    case 'number': {
      const def = typeof previous === 'number' ? previous : s.default;
      return { id: s.key, run: () => askNumeric(s.label, s.min, s.max, def) };
    }

    case 'object': {
      const prevItems =
        Array.isArray(previous) && previous.length > 0 ? (previous as Record<string, unknown>[]) : undefined;
      return { id: s.key, run: () => runObjectStep(s, prevItems) };
    }

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
  const MAX_ATTEMPTS = 3;
  // Re-ask on invalid input — silently substituting the default would turn
  // a typo into a wrong-but-valid generation. Blank = accept the default.
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const val = await askWithNav(`${label} (${hint})`);
    if (!val) return defaultVal;
    const num = Number(val);
    if (!Number.isNaN(num) && num >= min && num <= max) return num;
    getOutput().info(`Invalid: must be ${min}–${max}.`);
  }
  getOutput().info(defaultVal != null ? `Using default ${defaultVal}.` : 'Skipping.');
  return defaultVal;
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
  previous?: Record<string, unknown>[],
): Promise<NavResult<Record<string, unknown>[] | undefined>> {
  // Edit mode with existing items: offer to keep them. Declining the
  // replace-gate returns the PREVIOUS items — never silently drops them.
  if (previous) {
    const replace = await confirmWithNav({
      message: `Replace ${s.label}? (currently ${previous.length} item${previous.length === 1 ? '' : 's'})`,
      default: false,
    });
    if (replace === BACK || replace === CANCEL) return replace;
    if (!replace) return previous;
  } else if (s.required !== true) {
    // Optional opt-in gate — answers the user's "why am I being forced
    // to provide voice references for a simple video?" complaint.
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
  // Array slots (videoUrls / audioUrls) want Drive media too — seedance
  // extend and seed-audio models declare only those.
  const vidParam = Models.getFileParam(model.id, 'videoUrl') ?? Models.getFileParam(model.id, 'videoUrls');
  const audParam = Models.getFileParam(model.id, 'audioUrl') ?? Models.getFileParam(model.id, 'audioUrls');

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

/**
 * Array file slots — `videoUrls` / `audioUrls`. Models like
 * seedance-2.0-video-extend declare their ONLY file input this way (no
 * `videoUrl`), so without this the wizard can't collect their inputs at all.
 * Asks up to `max` files, stopping when the user picks nothing.
 */
async function promptMediaUrlsInputs(
  type: 'video' | 'audio',
  model: ModelDefinition,
  ctx: Readonly<Partial<GenerationContext>>,
  drive?: DrivePrefetch,
): Promise<Partial<GenerationContext>> {
  const key = type === 'video' ? 'videoUrls' : 'audioUrls';
  const param = Models.getFileParam(model.id, key);
  if (!param) return {};

  const existing = type === 'video' ? ctx.videoUrls : ctx.audioUrls;
  if (existing?.length) return {};

  const exts = type === 'video' ? VIDEO_EXTS : AUDIO_EXTS;
  const driveItems = type === 'video' ? drive?.videos : drive?.audios;
  const baseLabel = param.label || (type === 'video' ? 'Video' : 'Audio');
  const max = Math.max(1, param.max || 1);

  const values: string[] = [];
  for (let i = 0; i < max; i++) {
    const isRequired = !!param.required && i === 0;
    const counter = max > 1 ? ` ${i + 1} of ${max}` : '';
    const files = await promptFileInput({
      label: `${baseLabel}${counter} (${isRequired ? 'required' : 'optional'})`,
      required: isRequired,
      exts,
      mediaType: type,
      drive: drive ? { items: driveItems } : undefined,
    });
    if (files.length === 0) break;
    values.push(...files.slice(0, max - values.length));
    if (values.length >= max) break;
  }

  if (values.length === 0) return {};
  return type === 'video' ? { videoUrls: values } : { audioUrls: values };
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
  // Array slots — some models (seedance video-extend, seed-audio) declare
  // their media input ONLY through these.
  const vidsP = Models.getFileParam(model.id, 'videoUrls');
  const audsP = Models.getFileParam(model.id, 'audioUrls');
  // Treat startFrame as an image input for prompting purposes
  const effectiveImgP = imgP ?? sfP;
  if (!effectiveImgP && !vidP && !audP && !vidsP && !audsP) return {};

  const hasOptionalFiles =
    (effectiveImgP && !effectiveImgP.required) ||
    (vidP && !vidP.required) ||
    (audP && !audP.required) ||
    (vidsP && !vidsP.required) ||
    (audsP && !audsP.required);
  const hasRequiredFiles =
    effectiveImgP?.required || vidP?.required || audP?.required || vidsP?.required || audsP?.required;
  const isTextPrimary = model.inputType.startsWith('t');
  const ctxHasAnyFile = Boolean(
    ctx.imageUrls?.length ||
      ctx.startFrame ||
      ctx.videoUrl ||
      ctx.audioUrl ||
      ctx.videoUrls?.length ||
      ctx.audioUrls?.length,
  );

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
  if (vidsP) {
    Object.assign(updates, await promptMediaUrlsInputs('video', model, ctx, drive));
  }
  if (audsP) {
    Object.assign(updates, await promptMediaUrlsInputs('audio', model, ctx, drive));
  }

  return updates;
}

export function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY);
}
