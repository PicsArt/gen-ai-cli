/**
 * CLI Drive adapter — thin wrapper around the SDK client's drive methods.
 *
 * All auth is handled internally by getAiClient(), so callers no longer need
 * to pass DriveAuth. Function signatures are kept simple for consumers.
 */
import type { DriveFileDetails, DriveFolder, DriveMediaItem, SaveParams } from '@picsart/ai-sdk';
import { fuzzyFilter } from '#infra/utils/fuzzy.ts';
import { getAiClient } from './client.ts';

/** @deprecated Auth is now handled internally by the SDK client. Kept as an empty alias for migration. */
export interface DriveAuth {
  token: string;
  uid: string;
}

/** @deprecated Use DriveFolder (renamed from DriveFolderInfo) */
export type DriveFolderInfo = DriveFolder;
export type { DriveFileDetails, DriveFolder, DriveMediaItem };

// ── Convenience wrappers ─────────────────────────────────────────────

export async function ensureRootFolder(): Promise<string> {
  const ai = await getAiClient();
  const folder = await ai.drive?.ensureFolder();
  if (!folder) throw new Error('Failed to ensure root Drive folder');
  return folder.uid;
}

export async function ensureSubfolder(name: string): Promise<string> {
  const ai = await getAiClient();
  const folder = await ai.drive?.ensureFolder(name);
  if (!folder) throw new Error(`Failed to ensure Drive subfolder: ${name}`);
  return folder.uid;
}

export async function listDriveFolders(): Promise<DriveFolderInfo[]> {
  const ai = await getAiClient();
  return (await ai.drive?.folders()) ?? [];
}

export async function listDriveAvailableFolders(): Promise<DriveFolderInfo[]> {
  const ai = await getAiClient();
  return (await ai.drive?.allFolders()) ?? [];
}

/** @deprecated Duplicate of listDriveAvailableFolders — kept as an alias. */
export const listDriveRootFolders = listDriveAvailableFolders;

export async function resolveDriveFolderByName(name: string): Promise<DriveFolderInfo | null> {
  const ai = await getAiClient();
  // BUG FIX: must await before ?? — findFolder() returns a Promise (always truthy),
  // so `?? null` was being applied to the Promise object, never to the resolved value.
  return (await ai.drive?.findFolder(name)) ?? null;
}

export async function listDriveMedia(filterType?: 'image' | 'video' | 'audio'): Promise<DriveMediaItem[]> {
  const ai = await getAiClient();
  return (await ai.drive?.list({ type: filterType })) ?? [];
}

export async function listDriveMediaInFolder(
  folderUid: string,
  filterType?: 'image' | 'video' | 'audio',
): Promise<DriveMediaItem[]> {
  const ai = await getAiClient();
  return (await ai.drive?.list({ folder: { uid: folderUid, name: '' }, type: filterType })) ?? [];
}

export async function listDriveMediaDetailed(filterType?: 'image' | 'video' | 'audio'): Promise<DriveFileDetails[]> {
  const ai = await getAiClient();
  return (await ai.drive?.listDetailed({ type: filterType })) ?? [];
}

export async function listDriveMediaInFolderDetailed(
  folderUid: string,
  filterType?: 'image' | 'video' | 'audio',
): Promise<DriveFileDetails[]> {
  const ai = await getAiClient();
  return (await ai.drive?.listDetailed({ folder: { uid: folderUid, name: '' }, type: filterType })) ?? [];
}

/**
 * Resolve a Drive folder by name with fuzzy matching fallback.
 * First tries exact (case-insensitive) match via SDK. If no match,
 * uses fuzzy search against available folders and returns the best match.
 */
export async function resolveDriveFolderFuzzy(name: string): Promise<DriveFolderInfo | null> {
  const exact = await resolveDriveFolderByName(name);
  if (exact) return exact;

  const folders = await listDriveAvailableFolders();
  const matches = fuzzyFilter(folders, name, (f) => f.name);
  if (matches.length >= 1) return matches[0];

  return null;
}

/** Extended save params — includes folderUid which the SDK SaveParams doesn't have. */
export interface CliSaveParams extends SaveParams {
  folderUid?: string;
}

export async function saveFileToDrive(params: CliSaveParams): Promise<string> {
  const ai = await getAiClient();
  const folder = params.folderUid ? { uid: params.folderUid, name: '' } : undefined;
  const result = await ai.drive?.save(params, folder);
  if (!result) throw new Error('Drive save failed');
  return result.uid;
}
