/**
 * Spec for the operation command builder.
 *
 * The orchestration lives in `runOperation`, a pure function — tests
 * drive every branch with the upstream pipeline mocked at the module
 * boundary. The oclif wrapper `createOperationCommand` is exercised
 * separately at the metadata level (no oclif machinery needed).
 */

import type { ModelDefinition } from '@picsart/ai-sdk';
import { describe, expect, it, vi } from 'vitest';
import type { FlowSpec } from '#flows';
import type { CliDeps } from '#root/deps.ts';
import type { ExecutionResult } from '#root/types.ts';

/* ── module mocks ────────────────────────────────────────────── */

const resolveInputsMock = vi.hoisted(() => vi.fn());
const executeMock = vi.hoisted(() => vi.fn());
const handleOutputMock = vi.hoisted(() => vi.fn());
const getAuthenticatedFetchMock = vi.hoisted(() => vi.fn());
const buildDriveContextMock = vi.hoisted(() => vi.fn());
const buildOutputConfigMock = vi.hoisted(() => vi.fn());
const handleCreditsErrorMock = vi.hoisted(() => vi.fn());
const isCreditsErrorMock = vi.hoisted(() => vi.fn());

const spinnerInstance = vi.hoisted(() => ({
  start: vi.fn(),
  succeed: vi.fn(),
  fail: vi.fn(),
  warn: vi.fn(),
  stop: vi.fn(),
  text: '',
}));
const createSpinnerMock = vi.hoisted(() => vi.fn());
const handleInputDirMock = vi.hoisted(() => vi.fn());
const trackGenerationCompletedMock = vi.hoisted(() => vi.fn());
const trackGenerationStartedMock = vi.hoisted(() => vi.fn());

vi.mock('./input-dir-preflight.ts', () => ({ handleInputDir: handleInputDirMock }));
vi.mock('#pipeline/02-resolve/resolve.ts', () => ({ resolveInputs: resolveInputsMock }));
vi.mock('#pipeline/03-execution/execute.ts', () => ({ execute: executeMock }));
vi.mock('#pipeline/04-output/handle.ts', () => ({ handleOutput: handleOutputMock }));
vi.mock('#services/client.ts', () => ({ getAuthenticatedFetch: getAuthenticatedFetchMock }));
vi.mock('#services/constants.ts', () => ({
  getApiUrl: () => 'https://api.test',
  getUploadUrl: () => 'https://upload.test',
}));
vi.mock('#services/user-config.ts', () => ({ getUserConfig: () => ({}) }));
vi.mock('#infra/ui-core/progress.ts', () => ({ createSpinner: createSpinnerMock }));
vi.mock('./helpers/build-drive-context.ts', () => ({ buildDriveContext: buildDriveContextMock }));
vi.mock('./helpers/build-output-config.ts', () => ({ buildOutputConfig: buildOutputConfigMock }));
vi.mock('./helpers/handle-credits-error.ts', () => ({
  handleCreditsError: handleCreditsErrorMock,
  isCreditsError: isCreditsErrorMock,
}));
vi.mock('./helpers/render-progress.ts', () => ({ createProgressHandler: () => vi.fn() }));
vi.mock('./helpers/track-generation.ts', () => ({
  trackGenerationCompleted: trackGenerationCompletedMock,
  trackGenerationStarted: trackGenerationStartedMock,
}));

import { createOperationCommand, runOperation } from './builder.ts';

/* ── fixtures ────────────────────────────────────────────────── */

function flow(overrides: Partial<FlowSpec> = {}): FlowSpec {
  return {
    id: 'test-flow',
    description: 'Test flow',
    modelFilter: () => true,
    requiredInputs: [],
    staticFlagGroups: [],
    staticStepGroups: [],
    examples: ['gen-ai test-flow -p hello'],
    ...overrides,
  } as FlowSpec;
}

function deps(overrides: Partial<CliDeps['flags']> = {}): CliDeps {
  return {
    flags: { json: false, plain: false, quiet: false, debug: false, noInput: false, ...overrides },
  } as CliDeps;
}

const model: ModelDefinition = { id: 'm-1', name: 'Model 1' } as ModelDefinition;
const inputs = { model, params: {}, files: {} };
const completedResult: ExecutionResult = {
  status: 'completed',
  url: 'https://x/r.png',
  results: [{ type: 'image', url: 'https://x/r.png' }],
  model,
  params: {},
  durationMs: 2000,
};

const driveOutputConfig = {
  driveSave: true,
  driveFolder: 'gen-ai-cli',
  download: undefined,
  open: false,
  clipboard: false,
  bell: false,
  notify: false,
  jsonMode: false,
  quietMode: false,
  plainMode: false,
};

const noDriveOutputConfig = { ...driveOutputConfig, driveSave: false };

function resetAll() {
  resolveInputsMock.mockReset();
  executeMock.mockReset();
  handleOutputMock.mockReset();
  getAuthenticatedFetchMock.mockReset().mockResolvedValue({
    authenticatedFetch: vi.fn(),
    creds: { token: 't', uid: 'u' },
  });
  buildDriveContextMock.mockReset().mockResolvedValue({ folderUid: 'f-1' });
  buildOutputConfigMock.mockReset().mockReturnValue(driveOutputConfig);
  handleCreditsErrorMock.mockReset();
  isCreditsErrorMock.mockReset().mockReturnValue(false);
  createSpinnerMock.mockReset().mockReturnValue(spinnerInstance);
  trackGenerationCompletedMock.mockReset();
  trackGenerationStartedMock.mockReset();
  spinnerInstance.start.mockReset();
  spinnerInstance.succeed.mockReset();
  spinnerInstance.fail.mockReset();
  spinnerInstance.warn.mockReset();
  spinnerInstance.stop.mockReset();
}

/* ──────────────────────────────────────────────────────────── */
/*  Happy path                                                  */
/* ──────────────────────────────────────────────────────────── */

describe('runOperation — happy path', () => {
  it('runs the full pipeline and succeeds the spinner', async () => {
    resetAll();
    resolveInputsMock.mockResolvedValue(inputs);
    executeMock.mockResolvedValue(completedResult);

    const f = flow();
    await runOperation(f, { prompt: 'hello' }, deps());

    expect(resolveInputsMock).toHaveBeenCalledWith(f, { prompt: 'hello' }, expect.any(Object));
    expect(executeMock).toHaveBeenCalledOnce();
    expect(handleOutputMock).toHaveBeenCalledOnce();
    expect(spinnerInstance.start).toHaveBeenCalledOnce();
    expect(spinnerInstance.succeed).toHaveBeenCalledWith('Model 1 \u00B7 2s');
  });

  it('passes the flow through to resolveInputs unchanged', async () => {
    resetAll();
    resolveInputsMock.mockResolvedValue(inputs);
    executeMock.mockResolvedValue(completedResult);

    const f = flow({ id: 'image' });
    await runOperation(f, {}, deps());

    expect(resolveInputsMock.mock.calls[0][0]).toBe(f);
  });
});

/* ──────────────────────────────────────────────────────────── */
/*  --input-dir pre-flight short-circuits the normal pipeline    */
/* ──────────────────────────────────────────────────────────── */

describe('runOperation — --input-dir pre-flight', () => {
  it('delegates to handleInputDir and skips the normal pipeline', async () => {
    resetAll();
    handleInputDirMock.mockReset().mockResolvedValue(undefined);

    await runOperation(flow(), { 'input-dir': './photos', model: 'flux-pro' }, deps());

    expect(handleInputDirMock).toHaveBeenCalledOnce();
    // None of the normal pipeline pieces should run.
    expect(resolveInputsMock).not.toHaveBeenCalled();
    expect(executeMock).not.toHaveBeenCalled();
    expect(handleOutputMock).not.toHaveBeenCalled();
    expect(spinnerInstance.start).not.toHaveBeenCalled();
  });

  it('does not gate on --input-dir when the value is missing or empty', async () => {
    resetAll();
    handleInputDirMock.mockReset();
    resolveInputsMock.mockResolvedValue(inputs);
    executeMock.mockResolvedValue(completedResult);

    await runOperation(flow(), { 'input-dir': '' }, deps());

    expect(handleInputDirMock).not.toHaveBeenCalled();
    expect(resolveInputsMock).toHaveBeenCalled();
  });
});

/* ──────────────────────────────────────────────────────────── */
/*  resolveInputs returned null (interactive cancellation)      */
/* ──────────────────────────────────────────────────────────── */

describe('runOperation — interactive cancellation', () => {
  it('returns early when resolveInputs returns null', async () => {
    resetAll();
    resolveInputsMock.mockResolvedValue(null);

    await runOperation(flow(), {}, deps());

    expect(executeMock).not.toHaveBeenCalled();
    expect(handleOutputMock).not.toHaveBeenCalled();
    expect(getAuthenticatedFetchMock).not.toHaveBeenCalled();
    expect(spinnerInstance.start).not.toHaveBeenCalled();
  });
});

/* ──────────────────────────────────────────────────────────── */
/*  Drive context is built only when driveSave is true          */
/* ──────────────────────────────────────────────────────────── */

describe('runOperation — DriveContext gating', () => {
  it('builds DriveContext when outputConfig.driveSave is true', async () => {
    resetAll();
    buildOutputConfigMock.mockReturnValue(driveOutputConfig);
    resolveInputsMock.mockResolvedValue(inputs);
    executeMock.mockResolvedValue(completedResult);

    await runOperation(flow(), {}, deps());

    expect(buildDriveContextMock).toHaveBeenCalledWith({
      token: 't',
      uid: 'u',
      uploadUrl: 'https://upload.test',
      driveFolder: 'gen-ai-cli',
    });
  });

  it('skips DriveContext when outputConfig.driveSave is false', async () => {
    resetAll();
    buildOutputConfigMock.mockReturnValue(noDriveOutputConfig);
    resolveInputsMock.mockResolvedValue(inputs);
    executeMock.mockResolvedValue(completedResult);

    await runOperation(flow(), {}, deps());

    expect(buildDriveContextMock).not.toHaveBeenCalled();
    expect(handleOutputMock).toHaveBeenCalledWith(completedResult, noDriveOutputConfig, expect.any(Object), undefined);
  });
});

/* ──────────────────────────────────────────────────────────── */
/*  Execution result statuses                                   */
/* ──────────────────────────────────────────────────────────── */

describe('runOperation — execution result status', () => {
  it('fails the spinner on result.status === "cancelled"', async () => {
    resetAll();
    resolveInputsMock.mockResolvedValue(inputs);
    executeMock.mockResolvedValue({ ...completedResult, status: 'cancelled' });

    await runOperation(flow(), {}, deps());

    expect(spinnerInstance.fail).toHaveBeenCalledWith('Cancelled');
    expect(handleOutputMock).toHaveBeenCalledOnce();
  });

  it('fails the spinner on result.status === "failed"', async () => {
    resetAll();
    resolveInputsMock.mockResolvedValue(inputs);
    executeMock.mockResolvedValue({ ...completedResult, status: 'failed', error: 'boom' });

    await runOperation(flow(), {}, deps());

    expect(spinnerInstance.fail).toHaveBeenCalledWith('Failed');
  });

  it('warns the spinner when execute returns timeout', async () => {
    resetAll();
    resolveInputsMock.mockResolvedValue(inputs);
    executeMock.mockResolvedValue({ ...completedResult, status: 'timeout', taskId: 'job-xyz' });

    await runOperation(flow(), {}, deps());

    expect(spinnerInstance.warn).toHaveBeenCalledWith('Still running on server');
    expect(spinnerInstance.fail).not.toHaveBeenCalled();
    expect(spinnerInstance.succeed).not.toHaveBeenCalled();
  });

  it('always calls handleOutput, regardless of status', async () => {
    resetAll();
    resolveInputsMock.mockResolvedValue(inputs);
    executeMock.mockResolvedValue({ ...completedResult, status: 'failed' });

    await runOperation(flow(), {}, deps());

    expect(handleOutputMock).toHaveBeenCalledOnce();
  });
});

/* ──────────────────────────────────────────────────────────── */
/*  Error handling                                              */
/* ──────────────────────────────────────────────────────────── */

describe('runOperation — error handling', () => {
  it('swallows InsufficientCreditsError and delegates to handleCreditsError', async () => {
    resetAll();
    resolveInputsMock.mockResolvedValue(inputs);
    const err = new Error('insufficient credits');
    executeMock.mockRejectedValue(err);
    isCreditsErrorMock.mockReturnValue(true);

    await expect(runOperation(flow(), {}, deps())).resolves.toBeUndefined();
    expect(handleCreditsErrorMock).toHaveBeenCalledWith(err, expect.any(Object));
    expect(spinnerInstance.stop).toHaveBeenCalled();
  });

  it('sets process.exitCode = CREDITS_ERROR (7) when swallowing a credits error', async () => {
    resetAll();
    const prevExitCode = process.exitCode;
    process.exitCode = undefined;
    try {
      resolveInputsMock.mockResolvedValue(inputs);
      executeMock.mockRejectedValue(new Error('insufficient credits'));
      isCreditsErrorMock.mockReturnValue(true);

      await runOperation(flow(), {}, deps());

      expect(process.exitCode).toBe(7);
    } finally {
      process.exitCode = prevExitCode;
    }
  });

  it('rethrows non-credits errors and stops the spinner', async () => {
    resetAll();
    resolveInputsMock.mockResolvedValue(inputs);
    const err = new Error('network blew up');
    executeMock.mockRejectedValue(err);
    isCreditsErrorMock.mockReturnValue(false);

    await expect(runOperation(flow(), {}, deps())).rejects.toBe(err);
    expect(spinnerInstance.stop).toHaveBeenCalled();
    expect(handleCreditsErrorMock).not.toHaveBeenCalled();
  });
});

/* ──────────────────────────────────────────────────────────── */
/*  Analytics tracking coverage                                 */
/* ──────────────────────────────────────────────────────────── */

describe('runOperation — analytics tracking', () => {
  it('tracks start then completion with the resolved inputs on success', async () => {
    resetAll();
    resolveInputsMock.mockResolvedValue(inputs);
    executeMock.mockResolvedValue(completedResult);

    await runOperation(flow(), {}, deps());

    expect(trackGenerationStartedMock).toHaveBeenCalledTimes(1);
    expect(trackGenerationStartedMock).toHaveBeenCalledWith(expect.objectContaining({ inputs }));
    expect(trackGenerationCompletedMock).toHaveBeenCalledTimes(1);
    expect(trackGenerationCompletedMock).toHaveBeenCalledWith(
      expect.objectContaining({ inputs, result: completedResult }),
    );
  });

  it('tracks a resolve-time failure as completed with status=failed, inputs undefined', async () => {
    resetAll();
    const err = new Error('Model not found: "bogus"');
    resolveInputsMock.mockRejectedValue(err);

    await expect(runOperation(flow(), {}, deps())).rejects.toBe(err);

    expect(trackGenerationCompletedMock).toHaveBeenCalledTimes(1);
    expect(trackGenerationCompletedMock).toHaveBeenCalledWith(
      expect.objectContaining({ inputs: undefined, status: 'failed', error: err }),
    );
    // Failed before submitting — no start event.
    expect(trackGenerationStartedMock).not.toHaveBeenCalled();
  });

  it('does NOT track when resolveInputs returns null (user cancelled the wizard)', async () => {
    resetAll();
    resolveInputsMock.mockResolvedValue(null);

    await runOperation(flow(), {}, deps());

    expect(trackGenerationStartedMock).not.toHaveBeenCalled();
    expect(trackGenerationCompletedMock).not.toHaveBeenCalled();
  });

  it('tracks an auth failure (after resolve) as completed with status=failed', async () => {
    resetAll();
    resolveInputsMock.mockResolvedValue(inputs);
    const err = new Error('not logged in');
    getAuthenticatedFetchMock.mockRejectedValue(err);

    await expect(runOperation(flow(), {}, deps())).rejects.toBe(err);

    expect(trackGenerationCompletedMock).toHaveBeenCalledWith(
      expect.objectContaining({ inputs, status: 'failed', error: err }),
    );
    // Auth fails before we submit — no start event.
    expect(trackGenerationStartedMock).not.toHaveBeenCalled();
  });

  it('tracks an execute failure as start + completed(status=failed)', async () => {
    resetAll();
    resolveInputsMock.mockResolvedValue(inputs);
    const err = new Error('boom');
    executeMock.mockRejectedValue(err);

    await expect(runOperation(flow(), {}, deps())).rejects.toBe(err);

    expect(trackGenerationStartedMock).toHaveBeenCalledTimes(1);
    expect(trackGenerationCompletedMock).toHaveBeenCalledWith(
      expect.objectContaining({ inputs, status: 'failed', error: err }),
    );
  });

  it('does NOT emit a duplicate terminal event when handleOutput throws after a successful generation', async () => {
    resetAll();
    resolveInputsMock.mockResolvedValue(inputs);
    executeMock.mockResolvedValue(completedResult);
    const err = new Error('download failed');
    handleOutputMock.mockRejectedValue(err);

    await expect(runOperation(flow(), {}, deps())).rejects.toBe(err);

    // Exactly one terminal event — the real result — and it is NOT the
    // status=failed one from the catch block.
    expect(trackGenerationCompletedMock).toHaveBeenCalledTimes(1);
    expect(trackGenerationCompletedMock).toHaveBeenCalledWith(
      expect.objectContaining({ inputs, result: completedResult }),
    );
    expect(trackGenerationCompletedMock).not.toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }));
  });
});

/* ──────────────────────────────────────────────────────────── */
/*  outputConfig wiring                                         */
/* ──────────────────────────────────────────────────────────── */

describe('runOperation — outputConfig wiring', () => {
  it('forces jsonMode when --output=json (even without --json)', async () => {
    resetAll();
    buildOutputConfigMock.mockReturnValue(driveOutputConfig);
    resolveInputsMock.mockResolvedValue(inputs);
    executeMock.mockResolvedValue(completedResult);

    await runOperation(flow(), { output: 'json' }, deps({ json: false }));

    expect(buildOutputConfigMock.mock.calls[0][2]).toMatchObject({ json: true });
  });

  it('forces jsonMode when global --json is set even if --output is undefined', async () => {
    resetAll();
    buildOutputConfigMock.mockReturnValue(driveOutputConfig);
    resolveInputsMock.mockResolvedValue(inputs);
    executeMock.mockResolvedValue(completedResult);

    await runOperation(flow(), {}, deps({ json: true }));

    expect(buildOutputConfigMock.mock.calls[0][2]).toMatchObject({ json: true });
  });
});

/* ──────────────────────────────────────────────────────────── */
/*  --poll-timeout flag                                         */
/* ──────────────────────────────────────────────────────────── */

describe('runOperation — --poll-timeout flag', () => {
  it('parses --poll-timeout and forwards pollTimeoutMs to execute', async () => {
    resetAll();
    resolveInputsMock.mockResolvedValue(inputs);
    executeMock.mockResolvedValue(completedResult);

    await runOperation(flow(), { prompt: 'hi', 'poll-timeout': '45m' }, deps());

    expect(executeMock).toHaveBeenCalledTimes(1);
    const options = executeMock.mock.calls[0][2];
    expect(options.pollTimeoutMs).toBe(45 * 60_000);
  });

  it('omits pollTimeoutMs when --poll-timeout is not provided', async () => {
    resetAll();
    resolveInputsMock.mockResolvedValue(inputs);
    executeMock.mockResolvedValue(completedResult);

    await runOperation(flow(), { prompt: 'hi' }, deps());

    const options = executeMock.mock.calls[0][2];
    expect(options.pollTimeoutMs).toBeUndefined();
  });

  it('throws UsageError on garbage --poll-timeout input', async () => {
    resetAll();
    resolveInputsMock.mockResolvedValue(inputs);
    executeMock.mockResolvedValue(completedResult);

    await expect(runOperation(flow(), { prompt: 'hi', 'poll-timeout': 'soon' }, deps())).rejects.toThrow(
      /Invalid duration/,
    );
    expect(executeMock).not.toHaveBeenCalled();
  });
});

/* ──────────────────────────────────────────────────────────── */
/*  createOperationCommand — metadata                           */
/* ──────────────────────────────────────────────────────────── */

describe('createOperationCommand — metadata', () => {
  it('copies summary from flow.description', () => {
    const cls = createOperationCommand(flow({ description: 'Foo bar' })) as unknown as { summary: string };
    expect(cls.summary).toBe('Foo bar');
  });

  it('copies examples from flow.examples', () => {
    const cls = createOperationCommand(flow({ examples: ['gen-ai a', 'gen-ai b'] })) as unknown as {
      examples: string[];
    };
    expect(cls.examples).toEqual(['gen-ai a', 'gen-ai b']);
  });

  it('uses an empty array when the flow has no examples (matches oclif Command.examples shape)', () => {
    const f = flow();
    delete (f as { examples?: unknown }).examples;
    const cls = createOperationCommand(f) as unknown as { examples: unknown[] };
    expect(cls.examples).toEqual([]);
  });

  it('exposes a flags object (composed from the flow)', () => {
    const cls = createOperationCommand(flow()) as unknown as { flags: Record<string, unknown> };
    expect(typeof cls.flags).toBe('object');
  });
});
