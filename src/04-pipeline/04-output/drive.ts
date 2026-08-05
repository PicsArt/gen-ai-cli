/**
 * Drive save orchestration — saves generation results to Picsart Drive.
 * Receives DriveContext from the command layer (which bridges auth from execution).
 */

import type { ModelDefinition } from '@picsart/ai-sdk';
import { inferResourceType } from '@picsart/ai-sdk';
import type { OutputDeps } from '#root/deps.ts';
import type { ExecutionResult } from '#root/types.ts';
import type { RunCompletion } from './drive-save.ts';
import { buildDriveSaveAttributes, generateSmartFilename } from './drive-save.ts';
import { captureVideoPreview } from './video-preview.ts';

export interface DriveContext {
  token: string;
  uid: string;
  folderUid: string;
  runCompletion: RunCompletion;
  uploadUrl: string;
  saveFn: (params: {
    url: string;
    name: string;
    resourceType: string;
    attributes?: Record<string, string>;
    folderUid?: string;
    previewUrl?: string;
  }) => Promise<string>;
}

/**
 * Save a generation result to Picsart Drive.
 * Returns silently on failure (Drive save is non-critical).
 */
export async function saveToDrive(result: ExecutionResult, driveCtx: DriveContext, deps: OutputDeps): Promise<void> {
  if (result.status !== 'completed' || !result.url) return;

  try {
    const model = result.model;
    const prompt = (result.params as Record<string, unknown>).prompt as string | undefined;

    const name = await generateSmartFilename(
      result.url,
      model.mode,
      prompt,
      model.name,
      model.inputType,
      driveCtx.runCompletion,
    );

    const attributes = buildDriveSaveAttributes(
      model as ModelDefinition,
      result.params as unknown as Parameters<typeof buildDriveSaveAttributes>[1],
    );

    let posterUrl: string | undefined;
    if (model.mode === 'video') {
      posterUrl = await captureVideoPreview(result.url, {
        token: driveCtx.token,
        uid: driveCtx.uid,
        uploadUrl: driveCtx.uploadUrl,
      });
    }

    deps.out.info('Saving to Picsart Drive...');
    await driveCtx.saveFn({
      url: result.url,
      name,
      resourceType: inferResourceType(model.mode),
      attributes,
      folderUid: driveCtx.folderUid,
      previewUrl: posterUrl,
    });
    deps.out.success('Saved to Drive');
  } catch (e) {
    deps.out.error(`Drive save failed: ${(e as Error).message}`);
  }
}
