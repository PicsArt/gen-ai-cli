/**
 * Spec for the history service.
 *
 * Contract:
 *   - loadHistory() returns [] when no file exists; never throws.
 *   - appendHistory() persists to ~/.gen-ai/history.json with 0o600.
 *   - URLs in entries are sanitized to drop query strings (pre-signed tokens).
 *   - rawResultUrl is preserved with its query string for chain operations.
 *   - History is trimmed to MAX_HISTORY=500 (oldest dropped).
 *   - getRecentHistory(n) returns last n in newest-first order.
 *   - getLastEntry() returns the most recently appended entry.
 *   - clearHistory() truncates to [] and returns true; returns false when no file.
 *   - Recent files tracker dedups, prepends newest, respects user config limit.
 *   - getRecentFilesByType() filters by type AND existence on disk.
 *   - Corrupt JSON is backed up to .bak and the service starts fresh.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  appendHistory,
  clearHistory,
  getEntryById,
  getLastEntry,
  getRecentFilesByType,
  getRecentHistory,
  type HistoryEntry,
  loadHistory,
  loadRecentFiles,
  trackRecentFile,
} from './history.ts';

let tmpHome: string;
let originalHome: string | undefined;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-ai-hist-'));
  originalHome = process.env.HOME;
  process.env.HOME = tmpHome;
});
afterEach(() => {
  if (originalHome !== undefined) process.env.HOME = originalHome;
  else delete process.env.HOME;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

const histPath = () => path.join(tmpHome, '.gen-ai', 'history.json');
const recentPath = () => path.join(tmpHome, '.gen-ai', 'recent-files.json');

function entry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    timestamp: '2026-01-01T00:00:00Z',
    model: 'flux',
    modelName: 'Flux',
    params: {},
    status: 'completed',
    ...overrides,
  };
}

/* ─────────────────────────────────────────────────────────────────────── */
/*  load / append / round-trip                                            */
/* ─────────────────────────────────────────────────────────────────────── */

describe('loadHistory + appendHistory', () => {
  it('loadHistory returns [] when the file does not exist', () => {
    expect(loadHistory()).toEqual([]);
  });

  it('appendHistory persists and loadHistory reads it back', () => {
    appendHistory(entry({ model: 'flux-pro' }));
    appendHistory(entry({ model: 'kling-v3' }));
    const all = loadHistory();
    expect(all.length).toBe(2);
    expect(all[0].model).toBe('flux-pro');
    expect(all[1].model).toBe('kling-v3');
  });

  it('writes history.json with 0o600 perms', () => {
    appendHistory(entry());
    const mode = fs.statSync(histPath()).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  URL sanitization                                                      */
/* ─────────────────────────────────────────────────────────────────────── */

describe('appendHistory — URL sanitization', () => {
  it('strips query strings from resultUrl (avoid persisting tokens)', () => {
    appendHistory(entry({ resultUrl: 'https://cdn.example.com/out.png?token=secret&exp=123' }));
    const saved = loadHistory()[0];
    expect(saved.resultUrl).toBe('https://cdn.example.com/out.png');
  });

  it('preserves rawResultUrl WITH the query string (for chained ops like extend)', () => {
    const url = 'https://cdn.example.com/out.mp4?token=secret&exp=123';
    appendHistory(entry({ resultUrl: url }));
    expect(loadHistory()[0].rawResultUrl).toBe(url);
  });

  it('strips query strings from imageUrls, videoUrl, audioUrl', () => {
    appendHistory(
      entry({
        imageUrls: ['https://cdn.example.com/img.png?t=x'],
        videoUrl: 'https://cdn.example.com/v.mp4?t=x',
        audioUrl: 'https://cdn.example.com/a.mp3?t=x',
      }),
    );
    const saved = loadHistory()[0];
    expect(saved.imageUrls?.[0]).toBe('https://cdn.example.com/img.png');
    expect(saved.videoUrl).toBe('https://cdn.example.com/v.mp4');
    expect(saved.audioUrl).toBe('https://cdn.example.com/a.mp3');
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  Trim + queries                                                        */
/* ─────────────────────────────────────────────────────────────────────── */

describe('appendHistory — trim', () => {
  it('keeps at most 500 entries (oldest dropped)', () => {
    for (let i = 0; i < 510; i++) appendHistory(entry({ model: `m-${i}` }));
    const all = loadHistory();
    expect(all.length).toBe(500);
    expect(all[0].model).toBe('m-10'); // first 10 dropped
    expect(all[499].model).toBe('m-509');
  });
});

describe('getRecentHistory', () => {
  it('returns the last n entries in newest-first order', () => {
    for (let i = 0; i < 5; i++) appendHistory(entry({ model: `m-${i}` }));
    const recent = getRecentHistory(3);
    expect(recent.length).toBe(3);
    expect(recent.map((e) => e.model)).toEqual(['m-4', 'm-3', 'm-2']);
  });

  it('returns [] for a limit of 0 — slice(-0) must not mean "everything"', () => {
    for (let i = 0; i < 5; i++) appendHistory(entry({ model: `m${i}` }));
    expect(getRecentHistory(0)).toEqual([]);
  });

  it('returns [] for a negative limit', () => {
    for (let i = 0; i < 5; i++) appendHistory(entry({ model: `m${i}` }));
    expect(getRecentHistory(-3)).toEqual([]);
  });

  it('defaults to 20 when no limit is passed', () => {
    for (let i = 0; i < 25; i++) appendHistory(entry());
    expect(getRecentHistory().length).toBe(20);
  });
});

describe('getLastEntry', () => {
  it('returns null when history is empty', () => {
    expect(getLastEntry()).toBeNull();
  });

  it('returns the most recently appended entry', () => {
    appendHistory(entry({ model: 'first' }));
    appendHistory(entry({ model: 'last' }));
    expect(getLastEntry()?.model).toBe('last');
  });
});

describe('clearHistory', () => {
  it('returns false when no history file exists', () => {
    expect(clearHistory()).toBe(false);
  });

  it('truncates the file to [] and returns true', () => {
    appendHistory(entry());
    expect(clearHistory()).toBe(true);
    expect(loadHistory()).toEqual([]);
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  Recent files                                                          */
/* ─────────────────────────────────────────────────────────────────────── */

describe('trackRecentFile + loadRecentFiles', () => {
  it('persists the entry with a timestamp', () => {
    trackRecentFile('/tmp/a.png', 'image');
    const files = loadRecentFiles();
    expect(files.length).toBe(1);
    expect(files[0].path).toBe('/tmp/a.png');
    expect(files[0].type).toBe('image');
    expect(new Date(files[0].usedAt).toString()).not.toBe('Invalid Date');
  });

  it('deduplicates by path — tracking the same file twice keeps one entry, newest', () => {
    trackRecentFile('/tmp/a.png', 'image');
    trackRecentFile('/tmp/b.png', 'image');
    trackRecentFile('/tmp/a.png', 'image');
    const files = loadRecentFiles();
    expect(files.length).toBe(2);
    expect(files[0].path).toBe('/tmp/a.png'); // most recent first
  });

  it('caps at default limit (20) when user config has no recentFilesCount', () => {
    for (let i = 0; i < 25; i++) trackRecentFile(`/tmp/f-${i}.png`, 'image');
    expect(loadRecentFiles().length).toBe(20);
  });
});

describe('getRecentFilesByType', () => {
  it('filters by type AND existence on disk', () => {
    const realImage = path.join(tmpHome, 'real.png');
    const realVideo = path.join(tmpHome, 'real.mp4');
    fs.writeFileSync(realImage, 'data');
    fs.writeFileSync(realVideo, 'data');
    trackRecentFile(realImage, 'image');
    trackRecentFile('/nonexistent/ghost.png', 'image'); // exists check should drop
    trackRecentFile(realVideo, 'video');

    expect(getRecentFilesByType('image').map((f) => f.path)).toEqual([realImage]);
    expect(getRecentFilesByType('video').map((f) => f.path)).toEqual([realVideo]);
  });

  it('re-tracking the same path with a different type moves it between buckets', () => {
    // documents the actual dedup behavior (path-based, not (path,type)-based)
    const file = path.join(tmpHome, 'file.bin');
    fs.writeFileSync(file, 'data');
    trackRecentFile(file, 'image');
    trackRecentFile(file, 'video');
    expect(getRecentFilesByType('image')).toEqual([]);
    expect(getRecentFilesByType('video').map((f) => f.path)).toEqual([file]);
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  Corruption resilience                                                 */
/* ─────────────────────────────────────────────────────────────────────── */

describe('loadHistory — corruption resilience', () => {
  it('backs up corrupt JSON to .bak and returns []', () => {
    fs.mkdirSync(path.join(tmpHome, '.gen-ai'), { recursive: true });
    fs.writeFileSync(histPath(), '{ not valid json');
    expect(loadHistory()).toEqual([]);
    expect(fs.existsSync(`${histPath()}.bak`)).toBe(true);
  });
});

describe('loadRecentFiles — corruption resilience', () => {
  it('backs up corrupt JSON to .bak and returns []', () => {
    fs.mkdirSync(path.join(tmpHome, '.gen-ai'), { recursive: true });
    fs.writeFileSync(recentPath(), 'NOT JSON');
    expect(loadRecentFiles()).toEqual([]);
    expect(fs.existsSync(`${recentPath()}.bak`)).toBe(true);
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  Stable ids — assignment, backfill, and lookup                         */
/* ─────────────────────────────────────────────────────────────────────── */

describe('stable ids', () => {
  it('appendHistory assigns a g_ + 8-hex id', () => {
    appendHistory(entry());
    expect(loadHistory()[0].id).toMatch(/^g_[0-9a-f]{8}$/);
  });

  it('loadHistory backfills a deterministic id for legacy entries lacking one', () => {
    fs.mkdirSync(path.join(tmpHome, '.gen-ai'), { recursive: true });
    fs.writeFileSync(histPath(), JSON.stringify([entry({ prompt: 'legacy' })])); // no id
    const first = loadHistory()[0].id;
    expect(first).toMatch(/^g_[0-9a-f]{8}$/);
    expect(loadHistory()[0].id).toBe(first); // deterministic across loads
  });
});

describe('getEntryById', () => {
  function seed(): void {
    fs.mkdirSync(path.join(tmpHome, '.gen-ai'), { recursive: true });
    fs.writeFileSync(
      histPath(),
      JSON.stringify([
        entry({ id: 'g_ab111111', prompt: 'one' }),
        entry({ id: 'g_ab222222', prompt: 'two' }),
        entry({ id: 'g_cd333333', prompt: 'three' }),
      ]),
    );
  }

  it('resolves an exact id', () => {
    seed();
    expect(getEntryById('g_cd333333').entry?.prompt).toBe('three');
  });

  it('resolves a unique prefix, with or without the g_ head', () => {
    seed();
    expect(getEntryById('cd33').entry?.prompt).toBe('three');
    expect(getEntryById('g_cd3').entry?.prompt).toBe('three');
  });

  it('flags an ambiguous prefix', () => {
    seed();
    const result = getEntryById('ab');
    expect(result.entry).toBeNull();
    expect(result.ambiguous).toBe(true);
  });

  it('returns null (not ambiguous) when nothing matches', () => {
    seed();
    expect(getEntryById('zzzz')).toEqual({ entry: null, ambiguous: false });
  });
});
