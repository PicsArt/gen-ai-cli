/**
 * Spec for the `--input-dir` pre-flight hook.
 *
 * Contract:
 *   handleInputDir(flow, flags, deps):
 *     - no-op when --input-dir is missing
 *     - UsageError when --input-dir is set but --model is missing
 *     - UsageError when the model isn't in the flow's catalog
 *     - cancelled plan        → returns silently, no oclif dispatch
 *     - multi-generate plan   → oclifRun([flow.id, ...generateArgs])
 *     - run-batch plan        → oclifRun(['batch:run', ...batchArgs])
 *                               + best-effort unlink of the temp manifest
 *     - passthrough args      → every non-directory flag is forwarded
 *                               (--aspect-ratio, --save-to-drive, etc.)
 */
import type * as fs from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { FlowSpec } from '#flows';
import { UsageError } from '#infra/errors/usage.ts';
import type { CliDeps } from '#root/deps.ts';

const oclifRunMock = vi.hoisted(() => vi.fn());
const planInputDirMock = vi.hoisted(() => vi.fn());
const resolveModelFromFlagMock = vi.hoisted(() => vi.fn());
const unlinkSyncMock = vi.hoisted(() => vi.fn());

vi.mock('@oclif/core', () => ({ run: oclifRunMock }));
vi.mock('#pipeline/02-resolve/input-dir.ts', () => ({ planInputDir: planInputDirMock }));
vi.mock('#pipeline/02-resolve/types.ts', () => ({ resolveModelFromFlag: resolveModelFromFlagMock }));
vi.mock('node:fs', async () => {
  const real = await vi.importActual<typeof fs>('node:fs');
  return { ...real, unlinkSync: unlinkSyncMock };
});

import { handleInputDir } from './input-dir-preflight.ts';

function flow(): FlowSpec {
  return {
    id: 'image',
    description: 'Generate an image',
    modelFilter: () => true,
    requiredInputs: ['prompt'],
    staticFlagGroups: [],
    staticStepGroups: [],
  } as FlowSpec;
}

function deps(overrides: Partial<CliDeps['flags']> = {}): CliDeps {
  return {
    flags: { json: false, plain: false, quiet: false, debug: false, noInput: false, ...overrides },
  } as CliDeps;
}

/* ──────────────────────────────────────────────────────────────── */
/*  no-op                                                            */
/* ──────────────────────────────────────────────────────────────── */

describe('handleInputDir — no --input-dir', () => {
  it('returns silently when --input-dir is missing', async () => {
    oclifRunMock.mockReset();
    planInputDirMock.mockReset();
    await handleInputDir(flow(), {}, deps());
    expect(planInputDirMock).not.toHaveBeenCalled();
    expect(oclifRunMock).not.toHaveBeenCalled();
  });

  it('returns silently when --input-dir is an empty string', async () => {
    oclifRunMock.mockReset();
    planInputDirMock.mockReset();
    await handleInputDir(flow(), { 'input-dir': '' }, deps());
    expect(planInputDirMock).not.toHaveBeenCalled();
  });
});

/* ──────────────────────────────────────────────────────────────── */
/*  validation                                                       */
/* ──────────────────────────────────────────────────────────────── */

describe('handleInputDir — validation', () => {
  it('throws UsageError when --input-dir is set without --model', async () => {
    await expect(handleInputDir(flow(), { 'input-dir': './photos' }, deps())).rejects.toBeInstanceOf(UsageError);
  });

  it('throws UsageError when --model is not in the flow catalog', async () => {
    resolveModelFromFlagMock.mockReset().mockReturnValue(undefined);
    await expect(
      handleInputDir(flow(), { 'input-dir': './photos', model: 'unknown-model' }, deps()),
    ).rejects.toBeInstanceOf(UsageError);
  });
});

/* ──────────────────────────────────────────────────────────────── */
/*  plan dispatch                                                    */
/* ──────────────────────────────────────────────────────────────── */

describe('handleInputDir — multi-generate plan', () => {
  it('re-invokes the same operation via oclifRun with the plan args', async () => {
    resolveModelFromFlagMock.mockReset().mockReturnValue({ id: 'flux-pro' });
    planInputDirMock.mockReset().mockResolvedValue({
      kind: 'multi-generate',
      generateArgs: ['--model', 'flux-pro', '--image', 'a.png', '--image', 'b.png'],
    });
    oclifRunMock.mockReset().mockResolvedValue(undefined);

    await handleInputDir(flow(), { 'input-dir': './photos', model: 'flux-pro' }, deps());

    expect(oclifRunMock).toHaveBeenCalledOnce();
    const args = oclifRunMock.mock.calls[0][0];
    expect(args[0]).toBe('image'); // flow.id
    expect(args).toContain('--image');
    expect(args).toContain('a.png');
  });
});

describe('handleInputDir — run-batch plan', () => {
  it('dispatches to `batch:run` and cleans up the temp manifest', async () => {
    resolveModelFromFlagMock.mockReset().mockReturnValue({ id: 'flux-pro' });
    planInputDirMock.mockReset().mockResolvedValue({
      kind: 'run-batch',
      batchArgs: ['/tmp/manifest.json', '--concurrency', '3'],
      tmpFile: '/tmp/manifest.json',
    });
    oclifRunMock.mockReset().mockResolvedValue(undefined);
    unlinkSyncMock.mockReset();

    await handleInputDir(flow(), { 'input-dir': './photos', model: 'flux-pro' }, deps());

    expect(oclifRunMock).toHaveBeenCalledOnce();
    expect(oclifRunMock.mock.calls[0][0][0]).toBe('batch:run');
    expect(unlinkSyncMock).toHaveBeenCalledWith('/tmp/manifest.json');
  });

  it('still unlinks the temp manifest when batch:run throws', async () => {
    resolveModelFromFlagMock.mockReset().mockReturnValue({ id: 'flux-pro' });
    planInputDirMock.mockReset().mockResolvedValue({
      kind: 'run-batch',
      batchArgs: ['/tmp/m.json'],
      tmpFile: '/tmp/m.json',
    });
    oclifRunMock.mockReset().mockRejectedValue(new Error('batch failed'));
    unlinkSyncMock.mockReset();

    await expect(handleInputDir(flow(), { 'input-dir': './photos', model: 'flux-pro' }, deps())).rejects.toThrow(
      'batch failed',
    );
    expect(unlinkSyncMock).toHaveBeenCalledWith('/tmp/m.json');
  });
});

describe('handleInputDir — cancelled plan', () => {
  it('returns silently without dispatching when the user cancels at the mode picker', async () => {
    resolveModelFromFlagMock.mockReset().mockReturnValue({ id: 'flux-pro' });
    planInputDirMock.mockReset().mockResolvedValue({ kind: 'cancelled' });
    oclifRunMock.mockReset();

    await handleInputDir(flow(), { 'input-dir': './photos', model: 'flux-pro' }, deps());

    expect(oclifRunMock).not.toHaveBeenCalled();
  });
});

/* ──────────────────────────────────────────────────────────────── */
/*  passthrough args                                                 */
/* ──────────────────────────────────────────────────────────────── */

describe('handleInputDir — passthrough args', () => {
  it('forwards non-directory flags into planInputDir as extraArgs', async () => {
    resolveModelFromFlagMock.mockReset().mockReturnValue({ id: 'flux-pro' });
    planInputDirMock.mockReset().mockResolvedValue({ kind: 'cancelled' });

    await handleInputDir(
      flow(),
      {
        'input-dir': './photos',
        model: 'flux-pro',
        'aspect-ratio': '16:9',
        'save-to-drive': true,
        bell: false, // false-flag should NOT be forwarded
      },
      deps(),
    );

    const planArgs = planInputDirMock.mock.calls[0][0];
    expect(planArgs.extraArgs).toContain('--aspect-ratio');
    expect(planArgs.extraArgs).toContain('16:9');
    expect(planArgs.extraArgs).toContain('--save-to-drive');
    expect(planArgs.extraArgs).not.toContain('--bell');
  });

  it('does NOT forward the directory-specific flags themselves', async () => {
    resolveModelFromFlagMock.mockReset().mockReturnValue({ id: 'flux-pro' });
    planInputDirMock.mockReset().mockResolvedValue({ kind: 'cancelled' });

    await handleInputDir(
      flow(),
      { 'input-dir': './photos', model: 'flux-pro', multi: true, 'max-files': 50, concurrency: 5 },
      deps(),
    );

    const planArgs = planInputDirMock.mock.calls[0][0];
    expect(planArgs.extraArgs).not.toContain('--input-dir');
    expect(planArgs.extraArgs).not.toContain('--multi');
    expect(planArgs.extraArgs).not.toContain('--max-files');
    expect(planArgs.extraArgs).not.toContain('--concurrency');
  });

  it('expands repeatable array flags to one `--name value` pair per entry', async () => {
    resolveModelFromFlagMock.mockReset().mockReturnValue({ id: 'flux-pro' });
    planInputDirMock.mockReset().mockResolvedValue({ kind: 'cancelled' });

    await handleInputDir(
      flow(),
      {
        'input-dir': './photos',
        model: 'flux-pro',
        // Subfield flags of object descriptors (multi-shot prompts, etc.)
        // are repeatable arrays that should round-trip into the dispatched
        // child command, one `--name value` pair per entry.
        'multi-prompt-prompt': ['wide shot', 'close-up'],
      },
      deps(),
    );

    const extras = planInputDirMock.mock.calls[0][0].extraArgs as string[];
    const pairs = extras.join(' ');
    expect(pairs).toContain('--multi-prompt-prompt wide shot');
    expect(pairs).toContain('--multi-prompt-prompt close-up');
  });
});
