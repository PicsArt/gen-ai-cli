import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let _passed = 0;
let _failed = 0;

export async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    _passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } catch (e: unknown) {
    _failed++;
    console.log(`  \x1b[31m✗\x1b[0m ${name}`);
    console.log(`    ${(e as Error).message}`);
  }
}

export function summarize(suite: string) {
  console.log(`\n${suite}: ${_passed} passed, ${_failed} failed`);
  if (_failed > 0) process.exit(1);
}

export function resetCounters() {
  _passed = 0;
  _failed = 0;
}

export interface CapturedOutput {
  stdout: string;
  stderr: string;
}

export async function captureOutputAsync<T>(fn: () => Promise<T>): Promise<{ result: T } & CapturedOutput> {
  let stdout = '';
  let stderr = '';
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  process.stdout.write = (chunk: string | Uint8Array) => {
    stdout += String(chunk);
    return true;
  };
  process.stderr.write = (chunk: string | Uint8Array) => {
    stderr += String(chunk);
    return true;
  };
  try {
    const result = await fn();
    return { result, stdout, stderr };
  } finally {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
  }
}

export async function withTempHome<T>(fn: (home: string) => T | Promise<T>): Promise<T> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-ai-test-'));
  const origHome = process.env.HOME;
  process.env.HOME = tmp;
  try {
    return await fn(tmp);
  } finally {
    process.env.HOME = origHome ?? '';
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

export function writeTestCredentials(home: string) {
  const dir = path.join(home, '.gen-ai');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'credentials.json'),
    JSON.stringify({
      token: 'cached-token',
      refreshToken: 'ref-tok',
      uid: 'user-1',
      email: 'test@example.com',
      expiresAt: '2099-01-01T00:00:00.000Z',
    }),
  );
}

interface MockResponseDef {
  status?: number;
  body?: unknown;
  ok?: boolean;
}

export function mockFetch(responses: MockResponseDef[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  let idx = 0;
  const orig = globalThis.fetch;

  globalThis.fetch = async (url: unknown, init?: unknown) => {
    calls.push({ url: String(url), init: init as RequestInit });
    const resp = responses[Math.min(idx++, responses.length - 1)];
    const body = resp.body ?? {};
    return {
      ok: resp.ok ?? (resp.status ?? 200) < 400,
      status: resp.status ?? 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
      arrayBuffer: async () => new ArrayBuffer(0),
    } as Response;
  };

  return {
    calls,
    restore() {
      globalThis.fetch = orig;
    },
  };
}
