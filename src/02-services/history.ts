/**
 * Generation history — stores past generation entries in ~/.gen-ai/history.json.
 * Supports append, query, and recent file tracking.
 */
import { createHash, randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ensureDataDir, getDataDir } from '#infra/utils/data-dir.ts';
import { getUserConfig } from '#services/user-config.ts';

export interface HistoryEntry {
  /**
   * Stable short id (`g_` + 8 hex). Assigned on append; for entries written
   * before ids existed it is backfilled deterministically on load. Use it to
   * reference an entry for replay — unlike list position, it never shifts.
   */
  id?: string;
  timestamp: string;
  model: string;
  modelName: string;
  prompt?: string;
  params: Record<string, unknown>;
  imageUrls?: string[];
  videoUrl?: string;
  audioUrl?: string;
  resultUrl?: string;
  /** Full result URL including query params — used for chaining (e.g., extend --times). */
  rawResultUrl?: string;
  /** All result URLs when count > 1 (multi-result generation). */
  resultUrls?: string[];
  durationMs?: number;
  status: 'completed' | 'failed' | 'timeout';
  error?: string;
}

export interface RecentFile {
  path: string;
  type: 'image' | 'video' | 'audio';
  usedAt: string;
}

const MAX_HISTORY = 500;
const MAX_RECENT_FILES = 20;

function getHistoryPath(): string {
  return path.join(getDataDir(), 'history.json');
}

function getRecentFilesPath(): string {
  return path.join(getDataDir(), 'recent-files.json');
}

/** Fresh random id for a new entry. */
function generateEntryId(): string {
  return `g_${randomBytes(4).toString('hex')}`;
}

/**
 * Deterministic id for an entry written before ids existed. Derived from stable
 * fields so the same legacy entry resolves to the same id on every load (no file
 * rewrite needed). Collisions are theoretically possible but harmless — replay
 * just picks the first match.
 */
function deriveEntryId(entry: HistoryEntry): string {
  const seed = `${entry.timestamp}|${entry.model}|${entry.prompt ?? ''}|${entry.rawResultUrl ?? entry.resultUrl ?? ''}`;
  return `g_${createHash('sha1').update(seed).digest('hex').slice(0, 8)}`;
}

/** Load all history entries. Backs up corrupt files before starting fresh. */
export function loadHistory(): HistoryEntry[] {
  const historyPath = getHistoryPath();
  let raw: string;
  try {
    raw = fs.readFileSync(historyPath, 'utf-8');
  } catch {
    return [];
  }
  try {
    const entries = JSON.parse(raw) as HistoryEntry[];
    // Backfill ids for legacy entries (in-memory only) so every entry is
    // referenceable by a stable id without rewriting the file.
    for (const entry of entries) {
      if (!entry.id) entry.id = deriveEntryId(entry);
    }
    return entries;
  } catch {
    // Backup corrupt file before starting fresh
    try {
      fs.renameSync(historyPath, `${historyPath}.bak`);
    } catch {
      /* ignore */
    }
    return [];
  }
}

/** Strip query params from URLs to avoid storing pre-signed tokens. */
function sanitizeUrl(url?: string): string | undefined {
  if (!url) return url;
  try {
    return new URL(url).origin + new URL(url).pathname;
  } catch {
    return url;
  }
}

/** Append a new entry to history. */
export function appendHistory(entry: HistoryEntry): void {
  ensureDataDir();
  // Sanitize display URLs to avoid persisting pre-signed tokens.
  // rawResultUrl is intentionally NOT sanitized — it preserves the
  // pre-signed CDN token needed for VEO video extend chaining.
  const sanitized = {
    ...entry,
    id: entry.id ?? generateEntryId(),
    resultUrl: sanitizeUrl(entry.resultUrl),
    rawResultUrl: entry.rawResultUrl ?? entry.resultUrl,
    imageUrls: entry.imageUrls?.map(sanitizeUrl).filter(Boolean) as string[] | undefined,
    videoUrl: sanitizeUrl(entry.videoUrl),
    audioUrl: sanitizeUrl(entry.audioUrl),
  };
  const entries = loadHistory();
  entries.push(sanitized);
  const trimmed = entries.length > MAX_HISTORY ? entries.slice(-MAX_HISTORY) : entries;
  const dest = getHistoryPath();
  const tmp = `${dest}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(trimmed, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, dest);
}

/** Get the N most recent entries. */
export function getRecentHistory(limit = 20): HistoryEntry[] {
  return loadHistory().slice(-limit).reverse();
}

/** Get the last history entry. */
export function getLastEntry(): HistoryEntry | null {
  const entries = loadHistory();
  return entries.length > 0 ? entries[entries.length - 1] : null;
}

/**
 * Resolve an entry by its stable id. Accepts a full id or a unique prefix
 * (git-style), with or without the `g_` prefix. Returns null when nothing
 * matches; throws-style ambiguity is reported via the `ambiguous` flag so the
 * caller can give a clear error.
 */
export function getEntryById(ref: string): { entry: HistoryEntry | null; ambiguous: boolean } {
  const needle = ref.trim().toLowerCase();
  if (!needle) return { entry: null, ambiguous: false };
  const entries = loadHistory();

  const exact = entries.find((e) => e.id?.toLowerCase() === needle);
  if (exact) return { entry: exact, ambiguous: false };

  // Prefix match (allow the user to omit the `g_` and type just the hex head).
  const matches = entries.filter((e) => {
    const id = e.id?.toLowerCase() ?? '';
    return id.startsWith(needle) || id.replace(/^g_/, '').startsWith(needle.replace(/^g_/, ''));
  });
  if (matches.length === 1) return { entry: matches[0], ambiguous: false };
  if (matches.length > 1) return { entry: null, ambiguous: true };
  return { entry: null, ambiguous: false };
}

/** Load recent files list. Backs up corrupt files before starting fresh. */
export function loadRecentFiles(): RecentFile[] {
  const recentPath = getRecentFilesPath();
  let raw: string;
  try {
    raw = fs.readFileSync(recentPath, 'utf-8');
  } catch {
    return [];
  }
  try {
    return JSON.parse(raw) as RecentFile[];
  } catch {
    // Backup corrupt file before starting fresh
    try {
      fs.renameSync(recentPath, `${recentPath}.bak`);
    } catch {
      /* ignore */
    }
    return [];
  }
}

/** Track a file as recently used. */
export function trackRecentFile(filePath: string, type: 'image' | 'video' | 'audio'): void {
  ensureDataDir();
  const files = loadRecentFiles().filter((f) => f.path !== filePath);
  files.unshift({ path: filePath, type, usedAt: new Date().toISOString() });
  const configured = getUserConfig().recentFilesCount;
  const limit = Number.isFinite(configured) && configured! > 0 ? Math.min(configured!, 500) : MAX_RECENT_FILES;
  const trimmed = files.slice(0, limit);
  fs.writeFileSync(getRecentFilesPath(), JSON.stringify(trimmed, null, 2), { mode: 0o600 });
}

/** Get recent files filtered by media type. */
export function getRecentFilesByType(type: 'image' | 'video' | 'audio'): RecentFile[] {
  return loadRecentFiles().filter((f) => f.type === type && fs.existsSync(f.path));
}

/** Clear all history. */
export function clearHistory(): boolean {
  const p = getHistoryPath();
  if (fs.existsSync(p)) {
    fs.writeFileSync(p, '[]', { mode: 0o600 });
    return true;
  }
  return false;
}
