/**
 * Spec for output/display.
 *
 * Contract:
 *   displayResult(result, options, deps):
 *     - jsonMode  → writes a JSON payload via deps.out.json, returns
 *     - quietMode → writes only result.url via deps.out.result
 *     - rich mode → renders a card (to stderr) + success("Result: <url>")
 *
 *   displayFailedResult:
 *     - jsonMode  → writes { error, model, durationMs }
 *     - rich mode → calls deps.out.error with "Generation failed: <error>"
 *
 *   displayCancelledResult:
 *     - calls deps.out.info('Generation cancelled')
 *
 *   displayTimeoutResult:
 *     - jsonMode → writes { error, taskId, model, durationMs, status: 'timeout' }
 *     - rich mode → out.warn with task id + out.info with tip (and error if present)
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { OutputDeps } from '#root/deps.ts';
import type { ExecutionResult } from '#root/types.ts';
import { displayCancelledResult, displayFailedResult, displayResult, displayTimeoutResult } from './display.ts';

function makeDeps() {
  const calls: {
    json: unknown[];
    result: string[];
    success: string[];
    info: string[];
    error: string[];
    warn: string[];
  } = {
    json: [],
    result: [],
    success: [],
    info: [],
    error: [],
    warn: [],
  };
  return {
    calls,
    deps: {
      out: {
        json: (v: unknown) => calls.json.push(v),
        result: (s: string) => calls.result.push(s),
        success: (s: string) => calls.success.push(s),
        info: (s: string) => calls.info.push(s),
        error: (s: string) => calls.error.push(s),
        warn: (s: string) => calls.warn.push(s),
      },
      color: {
        link: (label: string, url: string) => `${label} (${url})`,
        red: (s: string) => s,
        green: (s: string) => s,
        bold: (s: string) => s,
        dim: (s: string) => s,
        brand: (s: string) => s,
        strip: (s: string) => s,
      },
    } as unknown as OutputDeps,
  };
}

function done(over: Partial<ExecutionResult> = {}): ExecutionResult {
  return {
    status: 'completed',
    url: 'https://x/a.png',
    results: [],
    model: { id: 'm', name: 'Model', mode: 'image' } as ExecutionResult['model'],
    params: {},
    durationMs: 1500,
    ...over,
  } as ExecutionResult;
}

let stderrWrites: string[];
let origWrite: typeof process.stderr.write;

beforeEach(() => {
  stderrWrites = [];
  origWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderrWrites.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
});
afterEach(() => {
  process.stderr.write = origWrite;
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  displayResult                                                         */
/* ─────────────────────────────────────────────────────────────────────── */

describe('displayResult', () => {
  it('jsonMode → emits one JSON payload to out.json, no stderr', () => {
    const { calls, deps } = makeDeps();
    displayResult(done(), { jsonMode: true, quietMode: false, plainMode: false }, deps);
    expect(calls.json.length).toBe(1);
    expect((calls.json[0] as { url: string }).url).toBe('https://x/a.png');
    expect(stderrWrites.length).toBe(0);
  });

  it('quietMode → writes only the URL via out.result', () => {
    const { calls, deps } = makeDeps();
    displayResult(done(), { jsonMode: false, quietMode: true, plainMode: false }, deps);
    expect(calls.result).toEqual(['https://x/a.png']);
    expect(stderrWrites.length).toBe(0);
  });

  it('rich mode → renders a card on stderr + success("Result: ...")', () => {
    const { calls, deps } = makeDeps();
    displayResult(done(), { jsonMode: false, quietMode: false, plainMode: false }, deps);
    expect(stderrWrites.join('')).toContain('Generation Complete');
    expect(calls.success[0]).toContain('https://x/a.png');
  });

  it('handles missing/undefined results array (no crash)', () => {
    const { deps } = makeDeps();
    expect(() =>
      displayResult(done({ results: undefined }), { jsonMode: false, quietMode: false, plainMode: false }, deps),
    ).not.toThrow();
  });

  it('shows item count when multi-result', () => {
    const { deps } = makeDeps();
    displayResult(
      done({ results: [{ url: 'a' } as never, { url: 'b' } as never] }),
      { jsonMode: false, quietMode: false, plainMode: false },
      deps,
    );
    expect(stderrWrites.join('')).toMatch(/2 items/);
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  displayFailedResult                                                   */
/* ─────────────────────────────────────────────────────────────────────── */

describe('displayFailedResult', () => {
  it('jsonMode → writes { error, model, durationMs }', () => {
    const { calls, deps } = makeDeps();
    displayFailedResult(
      done({ status: 'failed', error: 'boom' }),
      { jsonMode: true, quietMode: false, plainMode: false },
      deps,
    );
    expect((calls.json[0] as { error: string }).error).toBe('boom');
  });

  it('rich mode → calls out.error with "Generation failed: <error>"', () => {
    const { calls, deps } = makeDeps();
    displayFailedResult(
      done({ status: 'failed', error: 'boom' }),
      { jsonMode: false, quietMode: false, plainMode: false },
      deps,
    );
    expect(calls.error[0]).toContain('Generation failed');
    expect(calls.error[0]).toContain('boom');
  });

  it('rich mode falls back to "unknown error" when no error string', () => {
    const { calls, deps } = makeDeps();
    displayFailedResult(done({ status: 'failed' }), { jsonMode: false, quietMode: false, plainMode: false }, deps);
    expect(calls.error[0]).toContain('unknown');
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  displayCancelledResult                                                */
/* ─────────────────────────────────────────────────────────────────────── */

describe('displayCancelledResult', () => {
  it('writes "Generation cancelled" to out.info', () => {
    const { calls, deps } = makeDeps();
    displayCancelledResult(
      done({ status: 'cancelled' }),
      { jsonMode: false, quietMode: false, plainMode: false },
      deps,
    );
    expect(calls.info[0]).toContain('cancelled');
  });

  // --json consumers parse stdout — a cancel must produce a machine-readable
  // payload like failed/timeout do, not a bare human info line.
  it('jsonMode → writes { status: "cancelled", model, durationMs }', () => {
    const { calls, deps } = makeDeps();
    displayCancelledResult(
      done({ status: 'cancelled', taskId: 't-9' }),
      { jsonMode: true, quietMode: false, plainMode: false },
      deps,
    );
    expect(calls.json.length).toBe(1);
    expect(calls.json[0]).toMatchObject({ status: 'cancelled', model: 'm', durationMs: 1500 });
    expect(calls.info.length).toBe(0);
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  displayTimeoutResult                                                  */
/* ─────────────────────────────────────────────────────────────────────── */

describe('displayTimeoutResult', () => {
  it('jsonMode → writes { error, taskId, model, durationMs, status: "timeout" }', () => {
    const { calls, deps } = makeDeps();
    displayTimeoutResult(
      done({ status: 'timeout', taskId: 't-123', error: 'polling timed out', url: undefined }),
      { jsonMode: true, quietMode: false, plainMode: false },
      deps,
    );
    expect(calls.json.length).toBe(1);
    const payload = calls.json[0] as { status: string; taskId: string };
    expect(payload.status).toBe('timeout');
    expect(payload.taskId).toBe('t-123');
  });

  it('rich mode → warns with task id and infos the tip + error', () => {
    const { calls, deps } = makeDeps();
    displayTimeoutResult(
      done({ status: 'timeout', taskId: 't-123', error: 'polling timed out', url: undefined }),
      { jsonMode: false, quietMode: false, plainMode: false },
      deps,
    );
    expect(calls.warn[0]).toContain('t-123');
    expect(calls.info).toContain('polling timed out');
    expect(calls.info.some((m) => m.includes('gen-ai history'))).toBe(true);
  });

  it('rich mode falls back to "unknown" task id when none provided', () => {
    const { calls, deps } = makeDeps();
    displayTimeoutResult(
      done({ status: 'timeout', taskId: undefined, error: undefined, url: undefined }),
      { jsonMode: false, quietMode: false, plainMode: false },
      deps,
    );
    expect(calls.warn[0]).toContain('unknown');
  });
});
