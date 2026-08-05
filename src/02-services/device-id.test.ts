/**
 * Spec for device-id service.
 *
 * Contract:
 *   - Returns a UUIDv4 string.
 *   - First call persists the id to `~/.gen-ai/device-id`.
 *   - Subsequent calls return the same id (read from disk).
 *   - If the persisted value is corrupt/invalid, regenerates a fresh id.
 *   - Persisted file has restricted permissions (user-only).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDeviceId } from './device-id.ts';

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let tmpHome: string;
let originalHome: string | undefined;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-ai-device-'));
  originalHome = process.env.HOME;
  process.env.HOME = tmpHome;
});
afterEach(() => {
  if (originalHome !== undefined) process.env.HOME = originalHome;
  else delete process.env.HOME;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

describe('getDeviceId — first run', () => {
  it('returns a valid UUIDv4', () => {
    const id = getDeviceId();
    expect(id).toMatch(UUID_V4_RE);
  });

  it('persists the id under ~/.gen-ai/device-id', () => {
    const id = getDeviceId();
    const filePath = path.join(tmpHome, '.gen-ai', 'device-id');
    expect(fs.existsSync(filePath)).toBe(true);
    expect(fs.readFileSync(filePath, 'utf-8').trim()).toBe(id);
  });

  it('the persisted file has 0o600 permissions (user-only)', () => {
    getDeviceId();
    const filePath = path.join(tmpHome, '.gen-ai', 'device-id');
    const mode = fs.statSync(filePath).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});

describe('getDeviceId — subsequent runs', () => {
  it('returns the same id read from disk', () => {
    const first = getDeviceId();
    const second = getDeviceId();
    expect(second).toBe(first);
  });
});

describe('getDeviceId — corrupt persisted value', () => {
  it('regenerates when the file content is not a valid UUIDv4', () => {
    fs.mkdirSync(path.join(tmpHome, '.gen-ai'), { recursive: true });
    fs.writeFileSync(path.join(tmpHome, '.gen-ai', 'device-id'), 'not-a-uuid');
    const id = getDeviceId();
    expect(id).toMatch(UUID_V4_RE);
    expect(id).not.toBe('not-a-uuid');
  });

  it('regenerates when the file is empty', () => {
    fs.mkdirSync(path.join(tmpHome, '.gen-ai'), { recursive: true });
    fs.writeFileSync(path.join(tmpHome, '.gen-ai', 'device-id'), '');
    expect(getDeviceId()).toMatch(UUID_V4_RE);
  });
});
