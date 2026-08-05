import type { GenerationContext } from '@picsart/ai-sdk';
import { getOutput } from '#infra/ui-core/output.ts';
import type { UploadOptions } from '#services/file-upload.ts';
import { isLocalFile, uploadFile } from '#services/file-upload.ts';

async function resolveInput(value: string, opts: UploadOptions): Promise<string> {
  const v = value.trim();
  if (isLocalFile(v)) {
    getOutput().info(`Uploading ${v}...`);
    return uploadFile(v, opts);
  }
  return v;
}

export async function resolveGenerationInputs(ctx: Partial<GenerationContext>, opts: UploadOptions): Promise<void> {
  /* eslint-disable no-param-reassign */
  const imageUrls = (ctx.imageUrls ?? []).map((s) => s.trim()).filter(Boolean);
  if (imageUrls.length > 0) {
    const uploaded: string[] = [];
    for (const url of imageUrls) {
      uploaded.push(await resolveInput(url, opts));
    }
    ctx.imageUrls = uploaded;
  } else {
    ctx.imageUrls = undefined;
  }

  const videoUrl = typeof ctx.videoUrl === 'string' ? ctx.videoUrl.trim() : '';
  if (videoUrl) {
    ctx.videoUrl = await resolveInput(videoUrl, opts);
  } else {
    ctx.videoUrl = undefined;
  }

  const audioUrl = typeof ctx.audioUrl === 'string' ? ctx.audioUrl.trim() : '';
  if (audioUrl) {
    ctx.audioUrl = await resolveInput(audioUrl, opts);
  } else {
    ctx.audioUrl = undefined;
  }
  /* eslint-enable no-param-reassign */
}
