import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureDataDir, getDataDir } from './data-dir.ts';

let tmpHome: string;
let origHome: string | undefined;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-ai-test-'));
  origHome = process.env.HOME;
  process.env.HOME = tmpHome;
});

afterEach(() => {
  if (origHome === undefined) delete process.env.HOME;
  else process.env.HOME = origHome;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

describe('getDataDir', () => {
  it('returns <HOME>/.gen-ai', () => {
    expect(getDataDir()).toBe(`${tmpHome}/.gen-ai`);
  });
});

describe('ensureDataDir', () => {
  it('creates the directory if it does not exist', () => {
    const dir = `${tmpHome}/.gen-ai`;
    expect(fs.existsSync(dir)).toBe(false);
    ensureDataDir();
    expect(fs.existsSync(dir)).toBe(true);
    expect(fs.statSync(dir).isDirectory()).toBe(true);
  });

  it('is idempotent', () => {
    ensureDataDir();
    ensureDataDir(); // no throw
    expect(fs.existsSync(`${tmpHome}/.gen-ai`)).toBe(true);
  });
});
