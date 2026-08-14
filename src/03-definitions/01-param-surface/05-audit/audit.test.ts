/**
 * Spec for the drift auditor.
 *
 * Pure function over a Catalog. Tests build small fixture catalogs
 * via loadCatalog() so we exercise the same plumbing the runtime uses.
 */
import { Models } from '@picsart/ai-sdk';
import { describe, expect, it } from 'vitest';
import { MODEL_BOOLEAN, MODEL_ENUM_STRING, MODEL_RANGE, MODEL_TEXT } from '../__test-utils__/models-min.ts';
import { ALIAS_MAP } from '../01-primitives/01-aliases/index.ts';
import { loadCatalog, type ModelLike } from '../02-catalog/index.ts';
import { auditCatalog } from './audit.ts';
import { findFileWiringGaps } from './file-wiring.ts';
import { readResolverSources } from './source-reader.ts';

function buildCatalog(models: readonly ModelLike[]) {
  return loadCatalog(models, ALIAS_MAP);
}

describe('auditCatalog — totals', () => {
  it('counts every surface, split by alias-coverage', () => {
    const cat = buildCatalog([MODEL_TEXT, MODEL_BOOLEAN, MODEL_RANGE]);
    const report = auditCatalog(cat, new Set(Object.keys(ALIAS_MAP)), new Set());
    expect(report.totalSurfaces).toBe(cat.all().length);
    expect(report.withAlias + report.withoutAlias).toBe(report.totalSurfaces);
  });
});

describe('auditCatalog — descriptors without an alias entry', () => {
  it('lists every key not present in aliasKeys', () => {
    const cat = buildCatalog([MODEL_TEXT, MODEL_BOOLEAN]);
    const aliasKeys = new Set<string>(); // no aliases at all
    const report = auditCatalog(cat, aliasKeys, new Set());
    expect(report.noAlias).toHaveLength(cat.all().length);
    for (const entry of report.noAlias) {
      expect(typeof entry.key).toBe('string');
      expect(typeof entry.flag).toBe('string');
    }
  });

  it('omits keys that are in aliasKeys', () => {
    const cat = buildCatalog([MODEL_TEXT]);
    const someKey = cat.all()[0]?.key;
    if (!someKey) throw new Error('fixture must have at least one surface');
    const aliasKeys = new Set([someKey]);
    const report = auditCatalog(cat, aliasKeys, new Set());
    expect(report.noAlias.map((n) => n.key)).not.toContain(someKey);
  });
});

describe('auditCatalog — long flag names', () => {
  it('flags only names longer than the threshold', () => {
    const cat = buildCatalog([MODEL_TEXT, MODEL_BOOLEAN, MODEL_RANGE, MODEL_ENUM_STRING]);
    const report = auditCatalog(cat, new Set(), new Set(), { longFlagThreshold: 4 });
    for (const lf of report.longFlags) {
      expect(lf.length).toBeGreaterThan(4);
    }
  });

  it('reports each long flag with its existing aliases', () => {
    const cat = buildCatalog([MODEL_TEXT, MODEL_BOOLEAN, MODEL_RANGE, MODEL_ENUM_STRING]);
    const report = auditCatalog(cat, new Set(), new Set(), { longFlagThreshold: 0 });
    for (const lf of report.longFlags) {
      expect(Array.isArray(lf.aliases)).toBe(true);
    }
  });
});

describe('auditCatalog — orphan aliases', () => {
  it('classifies orphans as expected (exempt) or unexpected', () => {
    const cat = buildCatalog([MODEL_TEXT]); // small catalog
    const aliasKeys = new Set(['totallyFakeKey', 'externalTaskId']);
    const expectedOrphans = new Set(['externalTaskId']);
    const report = auditCatalog(cat, aliasKeys, expectedOrphans);

    const fake = report.orphans.find((o) => o.alias === 'totallyFakeKey');
    const known = report.orphans.find((o) => o.alias === 'externalTaskId');
    expect(fake?.expected).toBe(false);
    expect(known?.expected).toBe(true);

    expect(report.unexpectedOrphans).toContain('totallyFakeKey');
    expect(report.unexpectedOrphans).not.toContain('externalTaskId');
  });

  it('emits no orphans when every alias points to a real key', () => {
    const cat = buildCatalog([MODEL_TEXT]);
    const someKey = cat.all()[0]?.key;
    if (!someKey) throw new Error('fixture must have at least one surface');
    const report = auditCatalog(cat, new Set([someKey]), new Set());
    expect(report.orphans).toHaveLength(0);
    expect(report.unexpectedOrphans).toHaveLength(0);
  });
});

describe('auditCatalog — closed gaps', () => {
  it('lists expected orphans that the catalog now covers', () => {
    const cat = buildCatalog([MODEL_TEXT]);
    const liveKey = cat.all()[0]?.key;
    if (!liveKey) throw new Error('fixture must have at least one surface');
    const expectedOrphans = new Set([liveKey, 'someStillMissingKey']);
    const report = auditCatalog(cat, new Set([liveKey]), expectedOrphans);
    expect(report.closedGaps).toContain(liveKey);
    expect(report.closedGaps).not.toContain('someStillMissingKey');
  });
});

describe('auditCatalog — hasActionItems', () => {
  it('returns true when there are unexpected orphans', () => {
    const cat = buildCatalog([MODEL_TEXT]);
    const report = auditCatalog(cat, new Set(['notInCatalog']), new Set());
    expect(report.hasActionItems).toBe(true);
  });

  it('returns true when there are closed gaps', () => {
    const cat = buildCatalog([MODEL_TEXT]);
    const liveKey = cat.all()[0]?.key;
    if (!liveKey) throw new Error('fixture');
    const report = auditCatalog(cat, new Set([liveKey]), new Set([liveKey]));
    expect(report.hasActionItems).toBe(true);
  });

  it('returns false when the catalog is in sync', () => {
    const cat = buildCatalog([MODEL_TEXT]);
    const liveKey = cat.all()[0]?.key;
    if (!liveKey) throw new Error('fixture');
    const report = auditCatalog(cat, new Set([liveKey]), new Set());
    expect(report.hasActionItems).toBe(false);
  });

  it('returns true when fileWiringGaps is non-empty (caller injected gaps)', () => {
    const cat = buildCatalog([MODEL_TEXT]);
    const report = auditCatalog(cat, new Set(), new Set(), {
      fileWiringGaps: [
        {
          sdkKey: 'videoUrls',
          filesKey: 'videos',
          isArray: true,
          resolverMiss: true,
          executeMiss: false,
          validateMiss: false,
          unmappedKey: false,
        },
      ],
    });
    expect(report.hasActionItems).toBe(true);
    expect(report.fileWiringGaps).toHaveLength(1);
  });
});

/* ─────────────────────────────────────────────────────────────────────── */
/*  Real-SDK integration                                                  */
/* ─────────────────────────────────────────────────────────────────────── */

describe('file-wiring — against the real SDK catalog and real pipeline sources', () => {
  it('every file-kind descriptor is mapped and wired through resolver/execute/validate', () => {
    // This is the regression net for "the SDK shipped a new file-kind
    // descriptor and nobody wired it": Param Surface would still emit the
    // flag, but the value would silently never reach the payload. Runs in
    // `npm test`, not only via the `gen-ai dev:params` CI gate.
    const catalog = loadCatalog(Models.list(), ALIAS_MAP);
    const gaps = findFileWiringGaps(catalog, readResolverSources());
    const detail = gaps.map((g) => `${g.sdkKey} → ${g.unmappedKey ? 'NO MAPPING' : `files.${g.filesKey}`}`).join('; ');
    expect(gaps, `Unwired file slots: ${detail}`).toEqual([]);
  });
});
