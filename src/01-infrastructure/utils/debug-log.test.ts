/**
 * Debug log — append, rotation to MAX_ENTRIES, corrupted-file recovery,
 * and the size-cap regression (the trimmed entry list must be what is
 * actually written, and a single oversized entry must have its stack cut).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeDebugLog } from './debug-log.ts';

let tmpHome: string;
let origHome: string | undefined;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-ai-debuglog-'));
  origHome = process.env.HOME;
  process.env.HOME = tmpHome;
});

afterEach(() => {
  if (origHome === undefined) delete process.env.HOME;
  else process.env.HOME = origHome;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

function baseEntry(overrides: Partial<Parameters<typeof writeDebugLog>[0]> = {}) {
  return { cliVersion: '1.0.0', command: 'generate', error: 'boom', ...overrides };
}

function readLog(logPath: string): Array<Record<string, unknown>> {
  return JSON.parse(fs.readFileSync(logPath, 'utf-8'));
}

describe('writeDebugLog', () => {
  it('creates the log file with the full entry', () => {
    const logPath = writeDebugLog(baseEntry({ stack: 'stack-trace' }));
    expect(logPath).toBe(path.join(tmpHome, '.gen-ai', 'debug.log'));
    const entries = readLog(logPath);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      cliVersion: '1.0.0',
      command: 'generate',
      error: 'boom',
      stack: 'stack-trace',
      nodeVersion: process.version,
    });
    expect(typeof entries[0].timestamp).toBe('string');
  });

  it('appends entries and keeps only the last MAX_ENTRIES (5)', () => {
    let logPath = '';
    for (let i = 1; i <= 7; i++) {
      logPath = writeDebugLog(baseEntry({ error: `error-${i}` }));
    }
    const entries = readLog(logPath);
    expect(entries).toHaveLength(5);
    expect(entries[0].error).toBe('error-3');
    expect(entries[4].error).toBe('error-7');
  });

  it('starts fresh when the existing file is corrupted', () => {
    const dir = path.join(tmpHome, '.gen-ai');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'debug.log'), 'not json {');
    const logPath = writeDebugLog(baseEntry());
    expect(readLog(logPath)).toHaveLength(1);
  });

  it('drops older entries when the serialized log would exceed 1MB', () => {
    // Two entries with ~700KB stacks each: together >1MB, alone <1MB.
    writeDebugLog(baseEntry({ error: 'old', stack: 'x'.repeat(700_000) }));
    const logPath = writeDebugLog(baseEntry({ error: 'new', stack: 'y'.repeat(700_000) }));
    const entries = readLog(logPath);
    expect(entries).toHaveLength(1);
    expect(entries[0].error).toBe('new');
    expect(fs.statSync(logPath).size).toBeLessThanOrEqual(1_000_000);
  });

  it('caps the stack of a single entry that alone exceeds 1MB', () => {
    const logPath = writeDebugLog(baseEntry({ stack: 'z'.repeat(1_500_000) }));
    const entries = readLog(logPath);
    expect(entries).toHaveLength(1);
    expect((entries[0].stack as string).length).toBeLessThanOrEqual(10_000);
    expect(fs.statSync(logPath).size).toBeLessThanOrEqual(1_000_000);
  });
});
