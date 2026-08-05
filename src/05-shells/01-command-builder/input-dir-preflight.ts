/**
 * `--input-dir` pre-flight — expand a folder of files into either
 *   - one multi-file generation (the same operation, re-invoked with
 *     `--image/--video/--audio` per file), or
 *   - a batch run (one job per file, via the `batch:run` manifest runner).
 *
 * The builder factory runs this BEFORE the normal pipeline. If the user
 * didn't pass `--input-dir`, this helper isn't called.
 *
 * The plan-shape (`InputDirPlan`) is produced by `04-pipeline/02-resolve/
 * input-dir.ts` (pure data — file collection, mode picking, manifest
 * generation). This module is the dispatcher half: it routes the plan to
 * the right downstream command via oclif's `run()`.
 */
import * as fs from 'node:fs';
import { run as oclifRun } from '@oclif/core';
import type { FlowSpec } from '#flows';
import { UsageError } from '#infra/errors/usage.ts';
import { planInputDir } from '#pipeline/02-resolve/input-dir.ts';
import { resolveModelFromFlag } from '#pipeline/02-resolve/types.ts';
import type { CliDeps } from '#root/deps.ts';

/**
 * Args consumed by `planInputDir` directly, plus a small set of
 * pass-throughs (e.g. `--download`, `--no-download`) the plan re-injects
 * into the dispatched commands.
 */
const DIRECTORY_FLAG_NAMES = new Set([
  'input-dir',
  'multi',
  'batch',
  'type',
  'max-files',
  'concurrency',
  'model',
  'prompt',
  'dry-run',
  'silent',
  // file-shaped flags — the plan provides per-file expansions instead
  'image',
  'video',
  'audio',
]);

export async function handleInputDir(flow: FlowSpec, flags: Record<string, unknown>, deps: CliDeps): Promise<void> {
  const inputDir = flags['input-dir'];
  if (typeof inputDir !== 'string' || inputDir.length === 0) return;

  // 1. Model is required up-front — the plan needs to know what kind of
  //    inputs to expect (image/video/audio).
  const modelFlag = typeof flags.model === 'string' ? flags.model : undefined;
  if (!modelFlag) {
    throw new UsageError('--input-dir requires --model (-m) to know which model to dispatch.');
  }
  const model = resolveModelFromFlag(modelFlag, flow);
  if (!model) {
    throw new UsageError(`Model "${modelFlag}" is not in the ${flow.id} flow's catalog.`);
  }

  // 2. Carry through every flag the user typed that the plan didn't
  //    consume directly — `--download`, `--save-to-drive`, `--quiet`,
  //    descriptor params (`--aspect-ratio 16:9`), etc. Those re-appear
  //    on each dispatched child command so the user's intent is preserved.
  const extraArgs = passthroughArgs(flags);

  const plan = await planInputDir(
    {
      inputDir,
      model: modelFlag,
      prompt: typeof flags.prompt === 'string' ? flags.prompt : undefined,
      multi: flags.multi === true,
      batch: flags.batch === true,
      type: flags.type as 'image' | 'video' | 'audio' | undefined,
      maxFiles: typeof flags['max-files'] === 'number' ? (flags['max-files'] as number) : 30,
      concurrency: typeof flags.concurrency === 'number' ? (flags.concurrency as number) : 3,
      dryRun: flags['dry-run'] === true,
      silent: deps.flags.noInput,
      extraArgs,
    },
    model,
  );

  if (plan.kind === 'cancelled') return;

  if (plan.kind === 'multi-generate') {
    // Re-invoke THE SAME operation (flow.id) with expanded file flags.
    // The factory's normal pipeline takes over from there — `--input-dir`
    // is not present in the re-dispatched args so we don't recurse.
    await oclifRun([flow.id, ...plan.generateArgs]);
    return;
  }

  // run-batch: dispatch through the dedicated `batch:run` command.
  // Clean up the temp manifest after the runner returns.
  try {
    await oclifRun(['batch:run', ...plan.batchArgs]);
  } finally {
    try {
      fs.unlinkSync(plan.tmpFile);
    } catch {
      /* manifest cleanup — best effort */
    }
  }
}

/**
 * Args this dispatcher does NOT consume — passed through to whichever
 * downstream command (the re-dispatched operation or `batch:run`) the
 * plan picks. Reconstructed as `--name value` pairs from the parsed
 * flag bag.
 */
function passthroughArgs(flags: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const [name, value] of Object.entries(flags)) {
    if (DIRECTORY_FLAG_NAMES.has(name)) continue;
    if (value === undefined || value === null || value === false) continue;
    if (value === true) {
      out.push(`--${name}`);
      continue;
    }
    if (Array.isArray(value)) {
      for (const v of value) out.push(`--${name}`, String(v));
      continue;
    }
    out.push(`--${name}`, String(value));
  }
  return out;
}
