/**
 * `--max-cost` guard — get a generation's credit cost before submitting and
 * abort if it exceeds the ceiling.
 *
 * Prefers the **exact** backend cost via `ai.getCredits()` (the same `/options`
 * call the web app uses for its cost preview — a read-only query, no
 * generation). Falls back to the catalog price-range **max** (scaled by
 * duration × count) when the exact value can't be fetched (offline, not logged
 * in, or unsupported model), so the guard still works and stays conservative.
 */
import {
  type CreditRange,
  type CreditRangeContext,
  catalog,
  Model,
  type ModelDefinition,
  type TypedModelId,
} from '@picsart/ai-sdk';
import { UsageError } from '#infra/errors/usage.ts';
import type { OutputManager } from '#infra/ui-core/output.ts';
import { ensurePricingClient, getAiClient } from '#services/client.ts';

/** Resolved cost for a model: the value, and whether it's the exact backend figure. */
interface ResolvedCost {
  value: number;
  exact: boolean;
}

/** Exact backend cost via `getCredits` (the `/options` query). Null if unavailable. */
async function exactCost(modelId: string, params: Record<string, unknown>): Promise<number | null> {
  try {
    const ai = await getAiClient();
    const getCredits = ai.getCredits as (model: TypedModelId, p: Record<string, unknown>) => Promise<number | null>;
    const credits = await getCredits(modelId as TypedModelId, params);
    return typeof credits === 'number' ? credits : null;
  } catch {
    return null; // not logged in / network / unsupported → fall back to catalog
  }
}

/** Exact cost if the backend returns it, otherwise the catalog estimate. Assumes pricing is loaded. */
async function resolveCost(modelId: string, params: Record<string, unknown>): Promise<ResolvedCost | null> {
  const exact = await exactCost(modelId, params);
  if (exact != null) return { value: exact, exact: true };
  const estimate = creditEstimateForModel(modelId, params);
  return estimate == null ? null : { value: estimate, exact: false };
}

/**
 * Worst-case credit estimate from a range, scaling per-second pricing by
 * duration and multiplying by output count. Returns null when no range is
 * known (pricing unavailable for the model).
 */
export function estimateMaxCredits(
  range: CreditRange | null,
  opts: { duration?: number; count?: number },
): number | null {
  if (!range) return null;
  let max = range.max;
  if (range.unit === 'second' && opts.duration && opts.duration > 0) {
    max *= opts.duration;
  }
  const count = opts.count && opts.count > 0 ? opts.count : 1;
  return Math.ceil(max * count);
}

/**
 * Per-model worst-case estimate from `params` (resolution/audio/duration/count).
 * Assumes `catalog.pricing.load()` has already run. Null when pricing is unknown.
 */
export function creditEstimateForModel(modelId: string, params: Record<string, unknown>): number | null {
  const ctx: CreditRangeContext = {};
  if (typeof params.resolution === 'string') ctx.resolution = params.resolution;
  if (typeof params.generateAudio === 'boolean') ctx.generateAudio = params.generateAudio;

  const range = Model(modelId).getCreditsInfo(Object.keys(ctx).length ? ctx : undefined);
  const duration = typeof params.duration === 'number' ? params.duration : undefined;
  const count = typeof params.count === 'number' ? params.count : undefined;
  return estimateMaxCredits(range, { duration, count });
}

/**
 * Throws a `UsageError` when a single generation's cost exceeds `maxCost`.
 * Uses the exact backend cost when available, else the catalog estimate. No-op
 * (warns) when neither is available so the user isn't silently blocked.
 */
export async function enforceMaxCost(
  model: ModelDefinition,
  params: Record<string, unknown>,
  maxCost: number,
  out: OutputManager,
): Promise<void> {
  await ensurePricingClient();
  await catalog.pricing.load();

  const cost = await resolveCost(model.id, params);
  if (!cost) {
    out.warn(`Could not determine cost for ${model.name}; --max-cost not enforced for this run.`);
    return;
  }
  if (cost.value > maxCost) {
    const label = cost.exact ? `Cost ${cost.value}` : `Estimated cost ~${cost.value}`;
    throw new UsageError(
      `${label} credits exceeds --max-cost ${maxCost} for ${model.name}. ` +
        'Raise --max-cost or adjust params (resolution/duration/count) to proceed.',
    );
  }
}

/**
 * Throws when the TOTAL cost across multiple models exceeds `maxCost` — used by
 * `compare`, which runs one generation per model. Exact backend cost per model
 * when available, else catalog estimate. No-op (warns) if none are known.
 */
export async function enforceMaxCostForModels(
  models: ModelDefinition[],
  params: Record<string, unknown>,
  maxCost: number,
  out: OutputManager,
): Promise<void> {
  await ensurePricingClient();
  await catalog.pricing.load();

  const costs = await Promise.all(models.map((model) => resolveCost(model.id, params)));
  const known = costs.filter((cost): cost is ResolvedCost => cost != null);
  if (known.length === 0) {
    out.warn('Could not determine cost for any of the models; --max-cost not enforced for this run.');
    return;
  }

  const total = known.reduce((sum, cost) => sum + cost.value, 0);
  if (total > maxCost) {
    const label = known.every((cost) => cost.exact) ? `Total cost ${total}` : `Estimated total cost ~${total}`;
    throw new UsageError(
      `${label} credits across ${models.length} models exceeds --max-cost ${maxCost}. ` +
        'Raise --max-cost or compare fewer models.',
    );
  }
}
