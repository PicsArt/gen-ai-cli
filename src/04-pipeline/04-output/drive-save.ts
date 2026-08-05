/**
 * CLI-only Drive save helpers — smart filename generation and rich attributes.
 * These depend on model/context types and an LLM callback, so they live in the CLI,
 * not in the public SDK Drive client.
 */
import type { GenerationContext, ModelDefinition } from '@picsart/ai-sdk';

// ── Types ────────────────────────────────────────────────────────────

/** Callback that runs a chat completion and returns the raw result. */
export type RunCompletion = (payload: {
  model: string;
  messages: { role: string; content: string }[];
  max_tokens: number;
  temperature: number;
}) => Promise<{ choices?: { message?: { content?: string } }[] } | undefined>;

// ── Helpers ──────────────────────────────────────────────────────────

function getFileExt(url: string, mode: string): string {
  const ext = url.split('?')[0].split('.').pop()?.toLowerCase();
  if (ext && ['mp4', 'webm', 'mp3', 'wav', 'png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) return ext;
  if (mode === 'video') return 'mp4';
  if (mode === 'audio') return 'mp3';
  return 'png';
}

function buildDriveFileName(url: string, mode: string, prompt?: string): string {
  const ext = getFileExt(url, mode);
  const shortId = String(Date.now()).slice(-6);
  const promptSlug = (prompt || 'generation').slice(0, 40).replace(/[^a-zA-Z0-9]+/g, '-');
  return `${promptSlug}-${shortId}.${ext}`;
}

const FILENAME_SYSTEM_PROMPT =
  'Generate a short, descriptive filename for an AI-generated asset. ' +
  'Rules: 3-6 words, kebab-case, lowercase, English only, no file extension, ' +
  'no quotes, no markdown. Describe the visual/audio content, not the technical process. ' +
  'Example outputs: golden-hour-mountain-flight, neon-cyberpunk-city-rain, calm-ocean-waves-sunset';

function sanitizeFilename(raw: string): string {
  return raw
    .replace(/[`"'*_#]/g, '')
    .replace(/\s+/g, '-')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

// ── Public ───────────────────────────────────────────────────────────

/** Build Drive-compatible attribute map from model + generation context. */
export function buildDriveSaveAttributes(model: ModelDefinition, ctx: GenerationContext): Record<string, string> {
  const attributes: Record<string, string> = {
    tool: 'ai-playground',
    model: model.modelId || model.id,
    prompt: ctx.prompt || '',
    subType: model.inputType,
    service: model.provider,
  };
  if (ctx.duration != null) attributes.duration = String(ctx.duration);

  const extras: Record<string, unknown> = {};
  if (ctx.aspectRatio) extras.aspectRatio = ctx.aspectRatio;
  if (ctx.resolution) extras.resolution = ctx.resolution;
  if (ctx.quality) extras.quality = ctx.quality;
  if (ctx.imageUrls?.length) extras.referenceImageUrls = ctx.imageUrls;
  if (ctx.videoUrl) extras.referenceVideoUrl = ctx.videoUrl;
  if (ctx.audioUrl) extras.referenceAudioUrl = ctx.audioUrl;
  if (Object.keys(extras).length > 0) {
    attributes.textScript = JSON.stringify(extras);
  }
  return attributes;
}

/**
 * Generate a smart, descriptive filename using an LLM.
 * Falls back to a basic prompt-slug filename on failure.
 */
export async function generateSmartFilename(
  url: string,
  mode: string,
  prompt: string | undefined,
  modelName: string,
  inputType: string,
  runCompletion: RunCompletion,
): Promise<string> {
  const ext = getFileExt(url, mode);
  const shortId = String(Date.now()).slice(-6);

  if (!prompt) return buildDriveFileName(url, mode, prompt);

  try {
    const userPrompt = `Generate a kebab-case filename for this ${mode} (${inputType}) made with ${modelName}:\n"${prompt}"`;
    const result = await runCompletion({
      model: 'gpt-4.1-mini',
      messages: [
        { role: 'system', content: FILENAME_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 32,
      temperature: 0.3,
    });

    const raw = result?.choices?.[0]?.message?.content;
    if (!raw) throw new Error('Empty response');

    const stem = sanitizeFilename(raw);
    if (!stem) throw new Error('Sanitized to empty');

    return `${stem}-${shortId}.${ext}`;
  } catch {
    return buildDriveFileName(url, mode, prompt);
  }
}
