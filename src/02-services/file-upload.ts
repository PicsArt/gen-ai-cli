import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { FileError } from '#infra/errors/file.ts';
import { isNetworkError, NetworkError } from '#infra/errors/network.ts';
import { getUploadUrl, makeHeaders } from '#services/constants.ts';

const MAX_UPLOAD_SIZE = 500 * 1024 * 1024; // 500 MB

const MIME_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
  '.avif': 'image/avif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
};

export interface UploadOptions {
  token: string;
  uid: string;
}

export async function uploadFile(filePath: string, opts: UploadOptions): Promise<string> {
  const absPath = path.resolve(filePath);
  const stat = fs.statSync(absPath);
  if (stat.size > MAX_UPLOAD_SIZE) {
    throw new Error(`File too large (${Math.round(stat.size / 1024 / 1024)}MB). Maximum upload size is 500MB.`);
  }
  const ext = path.extname(absPath).toLowerCase();
  const mimeType = MIME_TYPES[ext] ?? 'application/octet-stream';
  const fileBuffer = await fsp.readFile(absPath);
  const blob = new Blob([fileBuffer], { type: mimeType });

  const formData = new FormData();
  formData.append('file', blob, path.basename(absPath));
  formData.append('type', 'editing-temp');

  // Let FormData set its own Content-Type with boundary — drop the JSON one.
  const headers: Record<string, string> = { ...makeHeaders(opts.token, opts.uid) };
  delete headers['Content-Type'];

  const UPLOAD_TIMEOUT_MS = 300_000; // 5 minutes for file uploads
  let res: Response;
  try {
    res = await fetch(`${getUploadUrl()}/v2/files`, {
      method: 'POST',
      headers,
      body: formData,
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    });
  } catch (err) {
    // Transport failure — surface it as such (exit 4) instead of a generic
    // "upload failed", so an offline/sandboxed shell is diagnosable.
    if (isNetworkError(err)) {
      throw new NetworkError(`upload to ${getUploadUrl()} failed (${(err as Error).message})`);
    }
    throw err;
  }

  if (!res.ok) {
    const body = await res.text();
    const cleanBody = body.startsWith('<') ? res.statusText || `HTTP ${res.status}` : body;
    throw new Error(`Upload failed (${res.status}): ${cleanBody}`);
  }

  const data = (await res.json()) as Record<string, unknown>;
  const response = data.response as Record<string, unknown> | undefined;
  const url = (response?.url as string | undefined) ?? (data.url as string | undefined);
  if (!url) throw new Error('No URL in upload response');
  return url;
}

export function isLocalFile(input: string): boolean {
  if (input.startsWith('http://') || input.startsWith('https://')) return false;
  try {
    return fs.existsSync(input);
  } catch {
    return false;
  }
}

/* ─────────────────────────────────────────────────────────────────────── */
/*  Higher-level resolution: paths → URLs                                 */
/* ─────────────────────────────────────────────────────────────────────── */

/** Resolve a single value: local path gets uploaded, URL passes through. */
export async function resolveFileInput(value: string, opts: UploadOptions): Promise<string> {
  const v = value.trim();
  if (isLocalFile(v)) return uploadFile(v, opts);
  if (v.startsWith('http://') || v.startsWith('https://')) return v;
  // Neither a reachable local file nor an http(s) URL — shipping this to the
  // backend produces a cryptic 500 ("Could not retrieve metadata for file: …").
  // Fail locally so the user sees the bad path.
  throw new FileError(v, 'file not found and not an http(s) URL');
}

export interface ResolvedFiles {
  images?: string[];
  startFrame?: string;
  endFrame?: string;
  video?: string;
  audio?: string;
  videos?: string[];
  audios?: string[];
  staticMask?: string;
  sceneImage?: string;
  styleImage?: string;
}

export interface InputFiles {
  images?: string[];
  startFrame?: string;
  endFrame?: string;
  video?: string;
  audio?: string;
  videos?: string[];
  audios?: string[];
  staticMask?: string;
  sceneImage?: string;
  styleImage?: string;
}

async function resolveArray(arr: string[] | undefined, opts: UploadOptions): Promise<string[] | undefined> {
  if (!arr || arr.length === 0) return undefined;
  const out: string[] = [];
  for (const v of arr) out.push(await resolveFileInput(v, opts));
  return out;
}

/** Resolve every file slot. Local paths get uploaded; URLs pass through. */
export async function resolveAllFiles(files: InputFiles, opts: UploadOptions): Promise<ResolvedFiles> {
  const resolved: ResolvedFiles = {};
  resolved.images = await resolveArray(files.images, opts);
  resolved.videos = await resolveArray(files.videos, opts);
  resolved.audios = await resolveArray(files.audios, opts);
  if (files.startFrame) resolved.startFrame = await resolveFileInput(files.startFrame, opts);
  if (files.endFrame) resolved.endFrame = await resolveFileInput(files.endFrame, opts);
  if (files.video) resolved.video = await resolveFileInput(files.video, opts);
  if (files.audio) resolved.audio = await resolveFileInput(files.audio, opts);
  if (files.staticMask) resolved.staticMask = await resolveFileInput(files.staticMask, opts);
  if (files.sceneImage) resolved.sceneImage = await resolveFileInput(files.sceneImage, opts);
  if (files.styleImage) resolved.styleImage = await resolveFileInput(files.styleImage, opts);
  return resolved;
}
