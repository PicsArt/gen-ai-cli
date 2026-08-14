/**
 * End-to-end wiring smoke test — every enabled model.
 *
 * For each model in the live SDK catalog, synthesize a flag bag covering
 * every paramConfig descriptor the flag-reader/resolver supports, then
 * run the scripted resolver → dry-run validator and assert the resulting
 * ctx contains every descriptor key we synthesized.
 *
 * What it catches that the Tier-1 audit doesn't:
 *   - text/boolean/enum/range keys silently dropped by a custom resolver
 *     branch (the flag-reader handles these generically, so this is mostly
 *     a behavioral smoke test — but new gnarly resolver branches can still
 *     drop values).
 *   - File-kind descriptors that need explicit resolver wiring beyond what
 *     `FILES_KEY_BY_SDK_KEY` declares. Tier 1 catches the static drift in
 *     `resolver.ts`; this catches the same regression at run time.
 *
 * What it intentionally skips:
 *   - Object-kind descriptors (multiPrompt, voiceList, omniImageList, …).
 *     Their CLI surface is per-subfield flags zipped by position
 *     (see `04-interpret/01-flag-reader/objects.ts`). Synthesizing them
 *     correctly per-model requires deeper knowledge than this smoke test
 *     wants to encode. Cover them in a dedicated object-array test if
 *     they become a regression hotspot.
 */
import type { ModelDefinition, ParamDescriptor } from '@picsart/ai-sdk';
import { Models } from '@picsart/ai-sdk';
import { describe, expect, it } from 'vitest';
import type { FlowSpec } from '#flows';
import { ALIAS_MAP, type Catalog, loadCatalog } from '#param-surface';
import type { CliDeps } from '#root/deps.ts';
import { resolveScripted } from './02-resolve/scripted/resolver.ts';
import { validateDryRun } from './03-execution/validate.ts';

/**
 * Model IDs the wiring test intentionally skips. Add entries here ONLY
 * for models that can't be exercised offline (e.g., a flow that demands
 * a real OAuth handshake before resolution). New gaps from real wiring
 * regressions belong in the model code, not on this list.
 */
const SKIP_MODELS: ReadonlySet<string> = new Set([]);

/**
 * SDK descriptor keys the synthesizer doesn't emit a flag for.
 * `model` is set separately. Anything else here is an admission of a
 * gap — review periodically.
 */
const SKIP_KEYS: ReadonlySet<string> = new Set(['model']);

/**
 * Descriptor keys that aren't expected to reach ctx end-to-end. Keep
 * this empty when possible — an entry here is an admission that the
 * wiring contract has a hole. Delete the moment the matching fix lands;
 * the test will catch the next regression on the same key automatically.
 */
const KNOWN_GAP_KEYS: ReadonlySet<string> = new Set([]);

interface SynthesizedFlags {
  flags: Record<string, unknown>;
  /** SDK keys (camelCase) that we expect to reach ctx after resolution. */
  expectedCtxKeys: readonly string[];
}

const ACCEPT_ALL_FLOW: FlowSpec = {
  id: 'all-models-wiring',
  description: 'every-model wiring smoke test',
  staticFlagGroups: [],
  staticStepGroups: [],
  modelFilter: () => true,
  requiredInputs: [],
};

const deps = { flags: {} } as CliDeps;

/**
 * Build a flag bag covering every supported descriptor on `model`. Uses
 * the merged catalog so flag names respect ALIAS_MAP (e.g. `imageUrls`
 * descriptor maps to `--image` / `-i`, not `--image-urls`).
 */
function synthesizeFlags(model: ModelDefinition, catalog: Catalog): SynthesizedFlags {
  const flags: Record<string, unknown> = { model: model.id };
  const expectedCtxKeys: string[] = [];

  for (const key of Object.keys(model.paramConfig)) {
    if (SKIP_KEYS.has(key)) continue;
    const surface = catalog.bySdkKey.get(key);
    if (!surface) continue;
    // Synthesize from the model's OWN descriptor — the resolver passes the
    // model id to the flag-reader, which coerces against exactly this
    // descriptor (the merged view is only the fallback for unknown models).
    const value = synthesizeForDescriptor(surface.descriptorsByModel.get(model.id) ?? surface.descriptor);
    if (value === undefined) continue;
    flags[surface.flag] = value;
    expectedCtxKeys.push(key);
  }

  return { flags, expectedCtxKeys };
}

function synthesizeForDescriptor(descriptor: ParamDescriptor): unknown {
  switch (descriptor.kind) {
    case 'text': {
      // Respect the model's own minLength (e.g. heygen prompts require 20+).
      const base = 'synthetic value';
      return base.padEnd(descriptor.minLength ?? 0, 'x');
    }
    case 'boolean':
      return descriptor.default ?? false;
    case 'range': {
      // Cast: RangeDescriptor types `default` as required, so TS collapses
      // the `??` fallback to never — but real catalogs ship range params
      // with no default (e.g. seed).
      const range = descriptor as { default?: number; min?: number };
      return range.default ?? range.min ?? 0;
    }
    case 'enum':
      return descriptor.options[0]?.id;
    case 'file': {
      const placeholder = 'https://example.com/synthetic-input';
      return descriptor.array ? [placeholder] : placeholder;
    }
    case 'object':
      // Object-array descriptors require per-subfield flag arrays. Out of
      // scope for this smoke test — see the module doc-comment.
      return undefined;
    default:
      return undefined;
  }
}

describe('paramConfig wiring — every enabled model survives resolver → ctx', () => {
  const catalog = loadCatalog(Models.list(), ALIAS_MAP);
  const models = Models.list().filter((each) => !each.disabled && !SKIP_MODELS.has(each.id));

  it('catalog exposes at least one enabled model to exercise', () => {
    expect(models.length).toBeGreaterThan(0);
  });

  for (const model of models) {
    it(`every synthesized paramConfig key reaches ctx for ${model.id}`, async () => {
      const { flags, expectedCtxKeys } = synthesizeFlags(model, catalog);
      const inputs = await resolveScripted(ACCEPT_ALL_FLOW, flags, deps);
      const result = validateDryRun(inputs);
      const ctx = result.context ?? {};

      const missingKeys = expectedCtxKeys.filter((key) => ctx[key] === undefined && !KNOWN_GAP_KEYS.has(key));

      expect(
        missingKeys,
        `Declared paramConfig keys missing from ctx for ${model.id}:\n` +
          `  ${missingKeys.join('\n  ')}\n` +
          'Either the resolver/file-pipeline dropped them or the flag-reader skipped them. ' +
          'For file-kind descriptors, also verify FILES_KEY_BY_SDK_KEY has a matching entry.\n' +
          `If this is an existing structural gap (see Tier 1 audit), add the key to ` +
          `KNOWN_GAP_KEYS with a note about which fix will close it.`,
      ).toEqual([]);
    });
  }
});
