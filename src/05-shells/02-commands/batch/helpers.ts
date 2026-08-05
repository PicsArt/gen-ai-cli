/**
 * Shared batch execution helpers used by batch run and batch resume.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { GenerationContext, TypedModelId } from '@picsart/ai-sdk';
import { createClient, findModel } from '@picsart/ai-sdk';
import { getOutput } from '#infra/ui-core/output.ts';
import { runPool } from '#infra/utils/pool.ts';
import { resolveGenerationInputs } from '#pipeline/02-resolve/media.ts';
import { getAuthenticatedFetch } from '#services/client.ts';
import { getApiUrl, getUploadUrl } from '#services/constants.ts';

export interface BatchJob {
  id: string;
  model: string;
  prompt?: string;
  [key: string]: unknown;
}

export interface BatchManifest {
  defaults?: Partial<GenerationContext>;
  jobs: BatchJob[];
}

export interface JobResult {
  id: string;
  model: string;
  status: 'completed' | 'failed' | 'skipped';
  url?: string;
  localPath?: string;
  error?: string;
  durationMs?: number;
}

export interface BatchResults {
  manifestPath?: string;
  jobs: JobResult[];
  startedAt: string;
  completedAt?: string;
}

/** Merge manifest-level defaults into jobs that lack their own model. */
export function applyManifestDefaults(manifest: BatchManifest): void {
  const defaultModel =
    ((manifest.defaults as Record<string, unknown>)?.model as string | undefined) ?? manifest.defaults?.modelId;
  for (const job of manifest.jobs) {
    if (!job.model && defaultModel) job.model = defaultModel;
  }
}

function sanitizeJobId(id: string): string {
  // eslint-disable-next-line no-control-regex
  let safe = path.basename(id).replace(/[<>:"|?*\x00-\x1f]/g, '_');
  if (/^(CON|PRN|AUX|NUL|COM\d|LPT\d)$/i.test(safe)) safe = `_${safe}`;
  return safe || 'job';
}

function inferExtFromUrl(url: string, modelId?: string): string {
  try {
    const pathname = new URL(url).pathname;
    const ext = path.extname(pathname);
    if (ext) return ext;
  } catch {
    /* fall through */
  }
  if (modelId) {
    const model = findModel(modelId);
    if (model?.mode === 'video') return '.mp4';
    if (model?.mode === 'audio') return '.mp3';
  }
  return '.png';
}

export function printSummary(results: BatchResults, label = 'Batch complete'): void {
  const completed = results.jobs.filter((j) => j.status === 'completed').length;
  const failed = results.jobs.filter((j) => j.status === 'failed').length;
  process.stdout.write(`${label}: ${completed} succeeded, ${failed} failed (of ${results.jobs.length} total)\n`);
}

export async function downloadResults(results: BatchResults, outputDir: string, concurrency: number): Promise<number> {
  const out = getOutput();
  const toDownload = results.jobs.filter((j) => j.status === 'completed' && j.url && !j.localPath);
  if (toDownload.length === 0) return 0;

  fs.mkdirSync(outputDir, { recursive: true });
  let count = 0;

  await runPool(toDownload, concurrency, async (job) => {
    const ext = inferExtFromUrl(job.url!, job.model);
    const safeId = sanitizeJobId(job.id);
    const destPath = path.join(outputDir, `${safeId}${ext}`);

    try {
      const res = await fetch(job.url!, { signal: AbortSignal.timeout(120_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = await res.arrayBuffer();
      fs.writeFileSync(destPath, Buffer.from(buf));
      job.localPath = destPath; // eslint-disable-line no-param-reassign -- intentional in-place update for results.json
      count++;
      out.success(`Downloaded: ${job.id}${ext}`);
    } catch (e) {
      out.error(`Download ${job.id}: ${(e as Error).message}`);
    }
  });

  return count;
}

export async function saveAndDownload(
  results: BatchResults,
  outputDir: string,
  flags: { noDownload: boolean; downloadConcurrency: number },
): Promise<void> {
  const out = getOutput();
  fs.mkdirSync(outputDir, { recursive: true });
  const resultsPath = path.join(outputDir, 'results.json');
  fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2));

  if (!flags.noDownload) {
    const dlCount = await downloadResults(results, outputDir, flags.downloadConcurrency);
    if (dlCount > 0) {
      fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2));
      out.info(`Downloaded ${dlCount} result(s) to ${outputDir}`);
    }
  }
}

export async function runBatch(
  manifest: BatchManifest,
  opts: { concurrency: number; output: string },
): Promise<BatchResults> {
  const out = getOutput();
  const results: BatchResults = { jobs: [], startedAt: new Date().toISOString() };
  const { authenticatedFetch, creds } = await getAuthenticatedFetch();
  const apiUrl = getApiUrl();
  const uploadUrl = getUploadUrl();
  const ai = createClient({ fetch: authenticatedFetch, apiUrl });

  const processJob = async (job: BatchJob): Promise<void> => {
    const start = Date.now();
    const model = findModel(job.model);
    if (!model) {
      results.jobs.push({ id: job.id, model: job.model, status: 'failed', error: `Model not found: ${job.model}` });
      return;
    }

    const ctx: Partial<GenerationContext> = { ...manifest.defaults };
    if (job.prompt) ctx.prompt = job.prompt;
    for (const [k, v] of Object.entries(job)) {
      if (k !== 'id' && k !== 'model') (ctx as Record<string, unknown>)[k] = v;
    }

    const uploadOpts = { token: creds.token, uid: creds.uid, uploadUrl };

    try {
      await resolveGenerationInputs(ctx, uploadOpts);
      out.info(`[${job.id}] Starting ${model.name}...`);

      if (model.syncExecute) {
        // Sync models — use ai.generate() directly (fast, no progress needed)
        const result = await ai.generate(model.id as TypedModelId, ctx as GenerationContext & { prompt: string });
        const durationMs = Date.now() - start;
        results.jobs.push({ id: job.id, model: job.model, status: 'completed', url: result.url, durationMs });
        out.success(`[${job.id}] Done (${(durationMs / 1000).toFixed(1)}s)`);
      } else {
        // Async models — submit + subscribe for progress
        const handle = await ai.submit(model.id as TypedModelId, ctx as GenerationContext & { prompt: string });
        for await (const status of ai.subscribe(handle, { intervalMs: 3000 })) {
          const elapsed = ((Date.now() - start) / 1000).toFixed(0);
          if (status.progress?.percent != null) {
            out.info(`[${job.id}] ${status.progress.percent}% (${elapsed}s)`);
          } else if (status.status !== 'COMPLETED' && status.status !== 'FAILED') {
            out.info(`[${job.id}] ${status.status} (${elapsed}s)`);
          }

          if (status.status === 'COMPLETED') {
            const result = await ai.result(handle, model.id as TypedModelId);
            const durationMs = Date.now() - start;
            results.jobs.push({ id: job.id, model: job.model, status: 'completed', url: result.url, durationMs });
            out.success(`[${job.id}] Done (${(durationMs / 1000).toFixed(1)}s)`);
            break;
          }
          if (status.status === 'FAILED') {
            const durationMs = Date.now() - start;
            results.jobs.push({ id: job.id, model: job.model, status: 'failed', error: status.error, durationMs });
            out.error(`[${job.id}] Failed: ${status.error}`);
            break;
          }
          if (status.status === 'CANCELED') {
            const durationMs = Date.now() - start;
            results.jobs.push({
              id: job.id,
              model: job.model,
              status: 'failed',
              error: 'Job was canceled',
              durationMs,
            });
            out.error(`[${job.id}] Canceled`);
            break;
          }
        }

        // If the iterator ended without a terminal status, record a failure
        if (!results.jobs.some((j) => j.id === job.id)) {
          const durationMs = Date.now() - start;
          results.jobs.push({
            id: job.id,
            model: job.model,
            status: 'failed',
            error: 'Job ended without terminal status',
            durationMs,
          });
          out.error(`[${job.id}] Ended without result`);
        }
      }
    } catch (e: unknown) {
      const durationMs = Date.now() - start;
      const msg = e instanceof Error ? e.message : String(e);
      const isCredits = msg.toLowerCase().includes('insufficient') || msg.includes('402');
      results.jobs.push({
        id: job.id,
        model: job.model,
        status: 'failed',
        error: isCredits ? `Insufficient credits: ${msg}` : msg,
        durationMs,
      });
      out.error(`[${job.id}] ${isCredits ? 'Insufficient credits' : 'Error'}: ${msg}`);
    }
  };

  try {
    await runPool(manifest.jobs, opts.concurrency, processJob);
  } finally {
    results.completedAt = new Date().toISOString();
  }
  return results;
}

export async function runBatchWithAuth(
  manifest: BatchManifest,
  opts: { concurrency: number; output: string },
): Promise<BatchResults> {
  return runBatch(manifest, opts);
}
