/**
 * Spec for the `gen-ai dev:params` command.
 *
 * The pure auditor is tested separately under
 * `03-definitions/01-param-surface/05-audit/`. These specs focus on the
 * oclif wrapper's behavior:
 *
 *   - exits 0 when the catalog is clean
 *   - exits 1 when the report has action items
 *   - --json prints the structured AuditReport and still exits 1 on drift
 *   - --long-flag-threshold flag is threaded into auditCatalog
 *   - the command is hidden (not shown in `gen-ai --help`)
 */
import { describe, expect, it, vi } from 'vitest';

const auditCatalogMock = vi.hoisted(() => vi.fn());
const loadCatalogMock = vi.hoisted(() => vi.fn(() => ({ all: () => [], bySdkKey: new Map(), byFlag: new Map() })));
const findFileWiringGapsMock = vi.hoisted(() => vi.fn(() => [] as readonly unknown[]));
const readResolverSourcesMock = vi.hoisted(() => vi.fn(() => ({ resolver: '', execute: '', validate: '' })));

vi.mock('#param-surface', () => ({
  ALIAS_MAP: { foo: { char: 'f' } },
  EXPECTED_SDK_GAPS: new Set<string>(),
  loadCatalog: loadCatalogMock,
  auditCatalog: auditCatalogMock,
  findFileWiringGaps: findFileWiringGapsMock,
  readResolverSources: readResolverSourcesMock,
}));
vi.mock('@picsart/ai-sdk', () => ({
  Models: { list: () => [] },
}));

import DevParams from './params.ts';

/* ── helpers ────────────────────────────────────────────────── */

function freshReport(overrides: Record<string, unknown> = {}) {
  return {
    totalSurfaces: 5,
    withAlias: 1,
    withoutAlias: 4,
    noAlias: [],
    longFlags: [],
    orphans: [],
    unexpectedOrphans: [],
    closedGaps: [],
    conflicts: [],
    fileWiringGaps: [],
    hasActionItems: false,
    ...overrides,
  };
}

function makeInstance(flags: { json?: boolean; longFlagThreshold?: number } = {}): {
  instance: object;
  calls: { json: unknown[]; warns: string[]; successes: string[]; exits: number[] };
} {
  const calls = { json: [] as unknown[], warns: [] as string[], successes: [] as string[], exits: [] as number[] };
  const noop = (s: string) => s;
  const deps = {
    color: {
      bold: noop,
      dim: noop,
      success: noop,
      error: noop,
      warning: noop,
    },
    out: {
      info: () => undefined,
      success: (s: string) => calls.successes.push(s),
      warn: (s: string) => calls.warns.push(s),
      result: () => undefined,
      json: (v: unknown) => calls.json.push(v),
      error: () => undefined,
    },
    flags: { json: flags.json ?? false, quiet: false, debug: false, plain: false, noInput: false },
  };
  // Derive from DevParams.prototype so private methods (renderHumanReport)
  // and BaseCommand getters (color / out / isJsonMode) resolve correctly.
  const instance = Object.create(DevParams.prototype);
  Object.assign(instance, {
    deps,
    parse: async () => ({ flags: { 'long-flag-threshold': flags.longFlagThreshold ?? 15, json: flags.json } }),
    exit: (code?: number) => {
      calls.exits.push(code ?? 0);
    },
  });
  return { instance, calls };
}

/* ── tests ──────────────────────────────────────────────────── */

describe('dev:params — metadata', () => {
  it('is hidden from `--help` (dev-only tool)', () => {
    const cls = DevParams as unknown as { hidden: boolean };
    expect(cls.hidden).toBe(true);
  });
});

describe('dev:params — clean catalog', () => {
  it('renders the "no drift detected" success message and does NOT exit non-zero', async () => {
    auditCatalogMock.mockReset().mockReturnValue(freshReport());
    const { instance, calls } = makeInstance();
    await DevParams.prototype.run.call(instance);
    expect(calls.successes.length).toBeGreaterThan(0);
    expect(calls.exits).toEqual([]);
  });
});

describe('dev:params — drift detected', () => {
  it('warns about action items and exits 1', async () => {
    auditCatalogMock.mockReset().mockReturnValue(
      freshReport({
        unexpectedOrphans: ['totallyFakeKey'],
        orphans: [{ alias: 'totallyFakeKey', expected: false }],
        hasActionItems: true,
      }),
    );
    const { instance, calls } = makeInstance();
    await DevParams.prototype.run.call(instance);
    expect(calls.warns.length).toBeGreaterThan(0);
    expect(calls.exits).toEqual([1]);
  });
});

describe('dev:params — --json mode', () => {
  it('emits the AuditReport as JSON and skips human rendering', async () => {
    const report = freshReport({ noAlias: [{ key: 'newKey', flag: 'new-key' }] });
    auditCatalogMock.mockReset().mockReturnValue(report);
    const { instance, calls } = makeInstance({ json: true });
    await DevParams.prototype.run.call(instance);
    expect(calls.json).toEqual([report]);
    expect(calls.successes).toEqual([]);
    expect(calls.warns).toEqual([]);
  });

  it('still exits 1 in --json mode when the report has action items', async () => {
    auditCatalogMock.mockReset().mockReturnValue(freshReport({ unexpectedOrphans: ['x'], hasActionItems: true }));
    const { instance, calls } = makeInstance({ json: true });
    await DevParams.prototype.run.call(instance);
    expect(calls.exits).toEqual([1]);
  });
});

describe('dev:params — threading flags into auditCatalog', () => {
  it('passes the --long-flag-threshold value through', async () => {
    auditCatalogMock.mockReset().mockReturnValue(freshReport());
    const { instance } = makeInstance({ longFlagThreshold: 8 });
    await DevParams.prototype.run.call(instance);
    expect(auditCatalogMock).toHaveBeenCalledOnce();
    const call = auditCatalogMock.mock.calls[0];
    expect(call?.[3]).toEqual({ longFlagThreshold: 8, fileWiringGaps: [] });
  });
});
