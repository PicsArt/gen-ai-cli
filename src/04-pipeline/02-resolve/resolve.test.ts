/**
 * Spec for the resolve dispatcher.
 *
 * Contract:
 *   resolveInputs(config, flags, deps):
 *     - interactive mode → calls resolveInteractive
 *     - non-interactive (scripted) → calls resolveScripted
 *     - mode decided by isInteractiveMode(deps.flags)
 *
 *   normalizePromptInput(flags) — pre-resolution prompt source unification:
 *     - --prompt wins over --prompt-file wins over piped stdin
 *     - --prompt-file failure raises FileError (typed, not a raw Error)
 *     - whitespace-only --prompt is treated as missing
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FlowSpec } from '#flows';
import { FileError } from '#infra/errors/file.ts';

const resolveInteractiveMock = vi.hoisted(() => vi.fn());
const resolveScriptedMock = vi.hoisted(() => vi.fn());
const resolveAllFilesMock = vi.hoisted(() => vi.fn());
const getAuthenticatedFetchMock = vi.hoisted(() => vi.fn());
const stdinLines = vi.hoisted(() => ({ value: [] as string[] }));

vi.mock('#pipeline/01-wizard-runner/resolver.ts', () => ({
  resolveInteractive: resolveInteractiveMock,
}));
vi.mock('./scripted/resolver.ts', () => ({
  resolveScripted: resolveScriptedMock,
}));
vi.mock('#services/file-upload.ts', () => ({
  resolveAllFiles: resolveAllFilesMock,
}));
vi.mock('#services/client.ts', () => ({
  getAuthenticatedFetch: getAuthenticatedFetchMock,
}));
vi.mock('node:readline', () => ({
  createInterface: () => {
    const listeners: Record<string, ((arg?: string) => void)[]> = { line: [], close: [] };
    const rl = {
      on(event: 'line' | 'close', cb: (arg?: string) => void) {
        listeners[event].push(cb);
        if (event === 'close') {
          queueMicrotask(() => {
            for (const ln of stdinLines.value) {
              for (const fn of listeners.line) fn(ln);
            }
            for (const fn of listeners.close) fn();
          });
        }
        return rl;
      },
    };
    return rl;
  },
}));

import { Models } from '@picsart/ai-sdk';
import type { CliDeps } from '#root/deps.ts';
import {
  deriveTopLevelPromptFromMulti,
  flagsFullySpecifyInputs,
  normalizePromptInput,
  resolveInputs,
} from './resolve.ts';

const config: FlowSpec = {
  id: 'test',
  description: 'test',
  staticFlagGroups: [],
  staticStepGroups: [],
  modelFilter: () => true,
  requiredInputs: [],
};

function makeDeps(flags: Partial<CliDeps['flags']> & { silent?: boolean }): CliDeps {
  return {
    flags: {
      json: false,
      plain: false,
      quiet: false,
      debug: false,
      noInput: false,
      ...flags,
    } as CliDeps['flags'],
  } as CliDeps;
}

describe('resolveInputs — dispatch', () => {
  it('routes to interactive when TTY + no --silent + no --no-input', async () => {
    // simulate TTY
    const orig = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    try {
      resolveInteractiveMock.mockResolvedValue({ scripted: false, files: {}, params: {}, model: {} });
      await resolveInputs(config, {}, makeDeps({}));
      expect(resolveInteractiveMock).toHaveBeenCalled();
      expect(resolveScriptedMock).not.toHaveBeenCalled();
    } finally {
      if (orig) Object.defineProperty(process.stdin, 'isTTY', orig);
    }
  });

  it('routes to scripted when --silent is set', async () => {
    resolveInteractiveMock.mockReset();
    resolveScriptedMock.mockReset();
    resolveScriptedMock.mockResolvedValue({ scripted: true, files: {}, params: {}, model: {} });
    await resolveInputs(config, {}, makeDeps({ silent: true }));
    expect(resolveScriptedMock).toHaveBeenCalled();
    expect(resolveInteractiveMock).not.toHaveBeenCalled();
  });

  it('routes to scripted when --no-input is set', async () => {
    resolveInteractiveMock.mockReset();
    resolveScriptedMock.mockReset();
    resolveScriptedMock.mockResolvedValue({ scripted: true, files: {}, params: {}, model: {} });
    await resolveInputs(config, {}, makeDeps({ noInput: true }));
    expect(resolveScriptedMock).toHaveBeenCalled();
  });

  it('routes to scripted when not a TTY', async () => {
    resolveInteractiveMock.mockReset();
    resolveScriptedMock.mockReset();
    resolveScriptedMock.mockResolvedValue({ scripted: true, files: {}, params: {}, model: {} });
    const orig = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
    stdinLines.value = []; // empty piped stdin
    try {
      await resolveInputs(config, {}, makeDeps({}));
      expect(resolveScriptedMock).toHaveBeenCalled();
    } finally {
      if (orig) Object.defineProperty(process.stdin, 'isTTY', orig);
    }
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  resolveInputs — file-upload gate                                      */
/*                                                                        */
/*  Local files must be uploaded (→ URLs) before execution for EVERY      */
/*  file slot, not just the classic five. A user whose only file input    */
/*  is --video-urls / --audio-urls / --static-mask / --scene-image /      */
/*  --style-image must not have raw local paths leak to the API.          */
/* ─────────────────────────────────────────────────────────────────────── */

describe('resolveInputs — file-upload gate', () => {
  const model = Models.list().find((m) => !m.disabled) ?? ({} as never);

  function scriptedWithFiles(files: Record<string, unknown>) {
    resolveInteractiveMock.mockReset();
    resolveScriptedMock.mockReset();
    resolveAllFilesMock.mockReset();
    getAuthenticatedFetchMock.mockReset();
    resolveScriptedMock.mockResolvedValue({ model, params: { prompt: 'p' }, files });
    getAuthenticatedFetchMock.mockResolvedValue({ creds: { token: 't', uid: 'u' } });
    resolveAllFilesMock.mockImplementation(async (f: unknown) => f);
  }

  it.each([
    ['videos', { videos: ['./local.mp4'] }],
    ['audios', { audios: ['./local.mp3'] }],
    ['staticMask', { staticMask: './mask.png' }],
    ['sceneImage', { sceneImage: './scene.png' }],
    ['styleImage', { styleImage: './style.png' }],
  ])('runs the upload step when the only file slot set is %s', async (_slot, files) => {
    scriptedWithFiles(files);
    await resolveInputs(config, {}, makeDeps({ silent: true }));
    expect(resolveAllFilesMock).toHaveBeenCalledWith(files, { token: 't', uid: 'u' });
  });

  it('skips the upload step when no file slot is set', async () => {
    scriptedWithFiles({});
    await resolveInputs(config, {}, makeDeps({ silent: true }));
    expect(resolveAllFilesMock).not.toHaveBeenCalled();
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  resolveInputs — vendor cross-field invariants (interactive path)      */
/*                                                                        */
/*  The Kling multi-shot pre-flight must run for BOTH resolution paths.   */
/*  A wizard user who builds a violating multi-shot config should fail    */
/*  fast locally, not wait for a polled 400 from the worker.              */
/* ─────────────────────────────────────────────────────────────────────── */

describe('resolveInputs — multi-shot pre-flight on the interactive path', () => {
  const model = Models.list().find((m) => !m.disabled) ?? ({} as never);

  it('rejects interactive multiShot params without a shotType', async () => {
    resolveInteractiveMock.mockReset();
    resolveScriptedMock.mockReset();
    resolveInteractiveMock.mockResolvedValue({
      model,
      params: { prompt: 'p', multiShot: true },
      files: {},
    });
    const orig = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    try {
      await expect(resolveInputs(config, {}, makeDeps({}))).rejects.toThrow(/--shot-type/);
    } finally {
      if (orig) Object.defineProperty(process.stdin, 'isTTY', orig);
    }
  });

  it('rejects interactive shot durations that do not sum to --duration', async () => {
    resolveInteractiveMock.mockReset();
    resolveScriptedMock.mockReset();
    resolveInteractiveMock.mockResolvedValue({
      model,
      params: {
        prompt: 'p',
        multiShot: true,
        shotType: 'customize',
        duration: 10,
        multiPrompt: [
          { prompt: 'a', duration: 3 },
          { prompt: 'b', duration: 4 },
        ],
      },
      files: {},
    });
    const orig = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    try {
      await expect(resolveInputs(config, {}, makeDeps({}))).rejects.toThrow(/must match/);
    } finally {
      if (orig) Object.defineProperty(process.stdin, 'isTTY', orig);
    }
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  flagsFullySpecifyInputs — array file slots                            */
/*                                                                        */
/*  Models like seedance-2.0-video-extend take their video via            */
/*  `--video-urls` (array slot). A user who passed everything on the      */
/*  command line must skip the wizard, exactly as `--video` users do.     */
/* ─────────────────────────────────────────────────────────────────────── */

describe('flagsFullySpecifyInputs — videoUrls/audioUrls models', () => {
  // Non-text-primary so no prompt is needed to fully specify (v2v extends).
  const videoUrlsOnly = Models.list().find(
    (m) =>
      !m.disabled &&
      !m.inputType.startsWith('t') &&
      !Models.getFileParam(m.id, 'videoUrl') &&
      !!Models.getFileParam(m.id, 'videoUrls'),
  );
  // All audioUrls-only models today are text-primary (tts) — pass a prompt.
  const audioUrlsOnly = Models.list().find(
    (m) => !m.disabled && !Models.getFileParam(m.id, 'audioUrl') && !!Models.getFileParam(m.id, 'audioUrls'),
  );

  it("accepts --video-urls for the 'video' requirement", () => {
    if (!videoUrlsOnly) return; // SDK has no such model right now — skip
    const flow: FlowSpec = { ...config, requiredInputs: ['video'] };
    expect(flagsFullySpecifyInputs(flow, { model: videoUrlsOnly.id, 'video-urls': ['clip.mp4'] })).toBe(true);
  });

  it("accepts --audio-urls for the 'audio' requirement", () => {
    if (!audioUrlsOnly) return; // SDK has no such model right now — skip
    const flow: FlowSpec = { ...config, requiredInputs: ['audio'] };
    expect(flagsFullySpecifyInputs(flow, { model: audioUrlsOnly.id, prompt: 'hi', 'audio-urls': ['track.mp3'] })).toBe(
      true,
    );
  });

  it('still rejects when neither --video nor --video-urls is given', () => {
    if (!videoUrlsOnly) return; // SDK has no such model right now — skip
    const flow: FlowSpec = { ...config, requiredInputs: ['video'] };
    expect(flagsFullySpecifyInputs(flow, { model: videoUrlsOnly.id })).toBe(false);
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  normalizePromptInput                                                   */
/* ─────────────────────────────────────────────────────────────────────── */

describe('normalizePromptInput', () => {
  let tmpDir: string;
  let origIsTTY: PropertyDescriptor | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'normalize-prompt-'));
    origIsTTY = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
    // Default to TTY so stdin isn't consumed unless a test opts in.
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (origIsTTY) Object.defineProperty(process.stdin, 'isTTY', origIsTTY);
  });

  it('leaves an explicit --prompt untouched (highest precedence)', async () => {
    const file = path.join(tmpDir, 'p.txt');
    fs.writeFileSync(file, 'from file');
    const out = await normalizePromptInput({ prompt: 'explicit', 'prompt-file': file });
    expect(out.prompt).toBe('explicit');
  });

  it('treats whitespace-only --prompt as missing and falls through', async () => {
    const file = path.join(tmpDir, 'p.txt');
    fs.writeFileSync(file, 'from file');
    const out = await normalizePromptInput({ prompt: '   ', 'prompt-file': file });
    expect(out.prompt).toBe('from file');
  });

  it('reads --prompt-file content (trimmed) into flags.prompt', async () => {
    const file = path.join(tmpDir, 'p.txt');
    fs.writeFileSync(file, '  multi\nline content  \n');
    const out = await normalizePromptInput({ 'prompt-file': file });
    expect(out.prompt).toBe('multi\nline content');
  });

  it('throws a typed FileError when --prompt-file does not exist', async () => {
    const flags: Record<string, unknown> = { 'prompt-file': path.join(tmpDir, 'missing.txt') };
    await expect(normalizePromptInput(flags)).rejects.toBeInstanceOf(FileError);
  });

  it('reads piped stdin when --prompt and --prompt-file are absent', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
    stdinLines.value = ['from stdin'];
    const out = await normalizePromptInput({});
    expect(out.prompt).toBe('from stdin');
  });

  it('reads multiline piped stdin (each line joined with \\n)', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
    stdinLines.value = ['line 1', 'line 2'];
    const out = await normalizePromptInput({});
    expect(out.prompt).toBe('line 1\nline 2');
  });

  it('leaves flags.prompt undefined when piped stdin is empty', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
    stdinLines.value = [];
    const out = await normalizePromptInput({});
    expect(out.prompt).toBeUndefined();
  });

  it('does NOT touch flags.prompt when stdin is a TTY and no flags are set', async () => {
    const out = await normalizePromptInput({});
    expect(out.prompt).toBeUndefined();
  });

  it('does not mutate the caller-owned flags object', async () => {
    const flags: Record<string, unknown> = { 'prompt-file': path.join(tmpDir, 'a.txt') };
    fs.writeFileSync(flags['prompt-file'] as string, 'hello');
    const before = { ...flags };
    const out = await normalizePromptInput(flags);
    expect(flags).toEqual(before);
    expect(out.prompt).toBe('hello');
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  deriveTopLevelPromptFromMulti                                         */
/*                                                                        */
/*  Closes the "why am I asked for a prompt again at the end?" UX gap:    */
/*  when the user filled in multi-shot prompts (Kling V3 etc.) we derive  */
/*  the top-level `prompt` from the first item. Pure function — does     */
/*  NOT mutate its argument.                                              */
/* ─────────────────────────────────────────────────────────────────────── */

describe('deriveTopLevelPromptFromMulti', () => {
  it('returns the first multiPrompt[0].prompt when no top-level prompt is set', () => {
    expect(
      deriveTopLevelPromptFromMulti({
        multiPrompt: [
          { prompt: 'wide shot of city', duration: '5' },
          { prompt: 'close-up', duration: '7' },
        ],
      }),
    ).toBe('wide shot of city');
  });

  it('returns undefined when an explicit prompt is already set (top-level always wins)', () => {
    expect(
      deriveTopLevelPromptFromMulti({
        prompt: 'overall vibe',
        multiPrompt: [{ prompt: 'wide shot' }],
      }),
    ).toBeUndefined();
  });

  it('trims whitespace on the derived prompt', () => {
    expect(deriveTopLevelPromptFromMulti({ multiPrompt: [{ prompt: '   neon city   ' }] })).toBe('neon city');
  });

  it('returns undefined when multiPrompt is absent', () => {
    expect(deriveTopLevelPromptFromMulti({ aspectRatio: '16:9' })).toBeUndefined();
  });

  it('returns undefined when multiPrompt is empty', () => {
    expect(deriveTopLevelPromptFromMulti({ multiPrompt: [] })).toBeUndefined();
  });

  it('returns undefined when multiPrompt[0] has no prompt subfield', () => {
    expect(deriveTopLevelPromptFromMulti({ multiPrompt: [{ duration: '5' }] })).toBeUndefined();
  });

  it('treats whitespace-only top-level prompt as missing and derives anyway', () => {
    expect(
      deriveTopLevelPromptFromMulti({
        prompt: '   ',
        multiPrompt: [{ prompt: 'shot one' }],
      }),
    ).toBe('shot one');
  });

  it('does not mutate the caller-owned params object', () => {
    const params: Record<string, unknown> = { multiPrompt: [{ prompt: 'a' }] };
    const before = { ...params };
    deriveTopLevelPromptFromMulti(params);
    expect(params).toEqual(before);
  });
});
