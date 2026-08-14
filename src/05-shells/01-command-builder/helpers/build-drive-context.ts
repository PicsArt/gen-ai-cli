/**
 * Build DriveContext — bridges runtime data into the output Drive-save flow.
 *
 * The Drive save flow goes ENTIRELY through `02-services/client.ts` —
 * `getAiClient()` is the only place an SDK client is constructed for
 * Drive operations. This helper just wires the resolved folder + a
 * saveFn callback (which itself calls `getAiClient().drive.save()`
 * inside `02-services/drive.ts`).
 */

import { getOutput } from '#infra/ui-core/output.ts';
import type { DriveContext } from '#pipeline/04-output/drive.ts';
import { getAiClient } from '#services/client.ts';
import { ensureRootFolder, ensureSubfolder, saveFileToDrive } from '#services/drive.ts';

export async function buildDriveContext(opts: {
  token: string;
  uid: string;
  uploadUrl: string;
  driveFolder?: string;
}): Promise<DriveContext | undefined> {
  try {
    const folderUid = opts.driveFolder ? await ensureSubfolder(opts.driveFolder) : await ensureRootFolder();

    return {
      token: opts.token,
      uid: opts.uid,
      folderUid,
      uploadUrl: opts.uploadUrl,
      runCompletion: async (payload) => {
        const ai = await getAiClient();
        const res = await ai.runWorkflow('CHAT_COMPLETIONS', payload as Record<string, unknown>, { mode: 'sync' });
        return res as { choices?: { message?: { content?: string } }[] } | undefined;
      },
      saveFn: (params) =>
        saveFileToDrive({
          url: params.url,
          name: params.name,
          resourceType: params.resourceType as 'PHOTO' | 'VIDEO' | 'AUDIO',
          attributes: params.attributes,
          folderUid: params.folderUid,
          previewUrl: params.previewUrl,
        }),
    };
  } catch (err) {
    // Non-fatal: the generation output must still be shown — but the user
    // asked for --save-to-drive, so a silent no-op would look like data loss.
    const msg = err instanceof Error ? err.message : String(err);
    getOutput().warn(`Drive save unavailable (${msg}) — result will not be saved to Drive`);
    return undefined;
  }
}
