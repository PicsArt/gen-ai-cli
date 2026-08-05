/**
 * Operation command factory.
 *
 * `createOperationCommand(flow)` turns a `FlowSpec` into a full oclif
 * `Command` class. Every operation command file in `02-commands/operations/`
 * becomes a single one-liner:
 *
 *     export default createOperationCommand(FLOWS['<id>']);
 *
 * The factory has two parts:
 *
 *   1. `runOperation(flow, flags, deps)` — pure async function holding the
 *      entire operation pipeline. Fully unit-tested with every upstream
 *      block mocked.
 *
 *   2. `createOperationCommand(flow)` — a thin oclif wrapper around (1).
 *      Only adds static metadata (summary, examples, flags) and calls
 *      `runOperation` from `run()`.
 *
 * The pipeline (private to this module — operation command files MUST
 * NOT reimplement any step):
 *
 *   1. Build `OutputConfig` from flags + user config + global flags.
 *   2. `resolveInputs(flow, flags, deps)` — interactive wizard or scripted.
 *   3. `getAuthenticatedFetch()` — single SDK client entry.
 *   4. Build `DriveContext` (only when Drive save is enabled).
 *   5. Spinner + SIGINT abort wiring.
 *   6. `execute(inputs, deps, options)` — sync/async SDK routing.
 *   7. `handleOutput(result, config, outDeps, driveCtx?)` — display, download,
 *      Drive save, history, extras.
 *   8. Friendly handling of `InsufficientCreditsError` (offers billing link).
 */
import { Models } from '@picsart/ai-sdk';
import type { FlowSpec } from '#flows';
import { composeFlagsForFlow } from '#flows';
import { createSpinner } from '#infra/ui-core/progress.ts';
import { getCatalog } from '#param-surface';
import { resolveInputs } from '#pipeline/02-resolve/resolve.ts';
import { execute } from '#pipeline/03-execution/execute.ts';
import { parseDuration } from '#pipeline/03-execution/parse-duration.ts';
import { handleOutput } from '#pipeline/04-output/handle.ts';
import { BaseCommand } from '#root/base-command.ts';
import type { CliDeps } from '#root/deps.ts';
import { toOutputDeps } from '#root/deps.ts';
import type { ResolvedInputs } from '#root/types.ts';
import { getAuthenticatedFetch } from '#services/client.ts';
import { getApiUrl, getUploadUrl } from '#services/constants.ts';
import { flushPulse } from '#services/pulse.ts';
import { getUserConfig } from '#services/user-config.ts';
import { buildDriveContext } from './helpers/build-drive-context.ts';
import { buildOutputConfig } from './helpers/build-output-config.ts';
import { handleCreditsError, isCreditsError } from './helpers/handle-credits-error.ts';
import { enforceMaxCost } from './helpers/max-cost.ts';
import { createProgressHandler } from './helpers/render-progress.ts';
import { trackGenerationCompleted, trackGenerationFailed } from './helpers/track-generation.ts';
import { handleInputDir } from './input-dir-preflight.ts';

/**
 * Pure pipeline driver. Doesn't know it is an oclif command — the only
 * inputs are the flow, the parsed flag bag, and the request-scoped deps.
 * Exported so that tests can drive every branch without standing up
 * oclif's `Command.run([])` machinery.
 */
export async function runOperation(flow: FlowSpec, flags: Record<string, unknown>, deps: CliDeps): Promise<void> {
  // Pre-flight: `--input-dir ./folder` expands a directory of files into
  // either one multi-input call (the same operation, re-invoked with
  // expanded `--image/--video/--audio` flags) or a batch (one call per
  // file, via the `batch:run` manifest runner). Either path short-circuits
  // the normal pipeline below.
  if (typeof flags['input-dir'] === 'string' && flags['input-dir'].length > 0) {
    await handleInputDir(flow, flags, deps);
    return;
  }

  const outputConfig = buildOutputConfig(flags, getUserConfig(), {
    json: deps.flags.json || flags.output === 'json',
    quiet: deps.flags.quiet,
    plain: deps.flags.plain,
  });

  // Assigned inside the try so the catch block can track failures from ANY
  // pipeline step (resolve, auth, drive context, execute) — not just execute.
  // All three may still be unset when the throw happened early.
  let inputs: ResolvedInputs | undefined;
  let spinner: ReturnType<typeof createSpinner> | undefined;
  let onSigint: (() => void) | undefined;

  try {
    const resolved = await resolveInputs(flow, flags, deps);
    if (!resolved) return;
    inputs = resolved;

    // Cost ceiling: abort before submitting if the estimate exceeds --max-cost.
    if (typeof flags['max-cost'] === 'number') {
      await enforceMaxCost(resolved.model, resolved.params, flags['max-cost'], deps.out);
    }

    const { authenticatedFetch, creds } = await getAuthenticatedFetch();
    const fetchFn = authenticatedFetch as unknown as typeof fetch;
    const apiUrl = getApiUrl();
    const uploadUrl = getUploadUrl();

    let driveCtx: Awaited<ReturnType<typeof buildDriveContext>> | undefined;
    if (outputConfig.driveSave) {
      driveCtx = await buildDriveContext({
        token: creds.token,
        uid: creds.uid,
        uploadUrl,
        driveFolder: outputConfig.driveFolder,
      });
    }

    const activeSpinner = createSpinner(`${resolved.model.name}...`, deps.flags.quiet);
    spinner = activeSpinner;
    const abortController = new AbortController();
    const handleSigint = () => {
      abortController.abort();
      activeSpinner.fail('Cancelled');
      process.removeListener('SIGINT', handleSigint);

      // Fast-exit on second Ctrl+C so users aren't stuck waiting for the
      // analytics flush below. Standard double-tap convention.
      process.once('SIGINT', () => process.exit(130));

      // Fire a cancellation event + flush before exiting. Without this the
      // POST starts but `process.exit()` below tears down sockets before the
      // request reaches the network. 130 is the conventional SIGINT exit code.
      // Fire-and-forget: emit the cancellation event + flush before tearing
      // down. `.catch` satisfies Biome's `noVoid`; in practice the finally's
      // `process.exit` kills the process before any rejection could surface.
      (async () => {
        try {
          trackGenerationFailed({
            flow,
            flags,
            inputs: resolved,
            error: new Error('User cancelled (SIGINT)'),
          });
          await flushPulse();
        } finally {
          process.exit(130);
        }
      })().catch(() => undefined);
    };
    onSigint = handleSigint;

    process.on('SIGINT', handleSigint);
    activeSpinner.start();

    const pollTimeoutFlag = flags['poll-timeout'];
    const pollTimeoutMs = typeof pollTimeoutFlag === 'string' ? parseDuration(pollTimeoutFlag) : undefined;

    const result = await execute(
      resolved,
      { apiUrl, uploadUrl, authenticatedFetch: fetchFn },
      { signal: abortController.signal, onProgress: createProgressHandler(activeSpinner), pollTimeoutMs },
    );

    // Fire one Pulse event per generation — captures flow, model, params,
    // files, status, duration. Fires for every terminal status (completed /
    // failed / cancelled / timeout) so we get a full funnel. Safe outside
    // the catch block: the SDK swallows transport errors internally.
    trackGenerationCompleted({ flow, flags, inputs: resolved, result });

    if (result.status === 'completed') {
      const secs = Math.floor(result.durationMs / 1000);
      activeSpinner.succeed(`${resolved.model.name} \u00B7 ${secs}s`);
    } else if (result.status === 'cancelled') {
      activeSpinner.fail('Cancelled');
    } else if (result.status === 'timeout') {
      activeSpinner.warn('Still running on server');
    } else {
      activeSpinner.fail('Failed');
    }

    process.removeListener('SIGINT', handleSigint);

    const outDeps = toOutputDeps(deps, { authenticatedFetch: fetchFn, uploadUrl });
    await handleOutput(result, outputConfig, outDeps, driveCtx);
  } catch (err) {
    if (onSigint) process.removeListener('SIGINT', onSigint);
    spinner?.stop();

    // Telemetry for the failure path. `inputs` is undefined when the throw
    // came from resolveInputs itself (e.g. model not found, invalid flag).
    trackGenerationFailed({ flow, flags, inputs, error: err });

    if (isCreditsError(err)) {
      await handleCreditsError(err, deps);
      return;
    }
    throw err;
  }
}

/**
 * Build an oclif Command class for the given FlowSpec.
 *
 * Returns an anonymous concrete subclass of `BaseCommand`. Return type
 * is inferred (not narrowed to `typeof Command`) so callers can use
 * the static `.run([...])` helper without TS losing the constructor
 * signature — `redo`, `extend`, and `models` invoke `Generate.run(args)`
 * exactly this way.
 *
 * Plug the result directly into `commands-manifest.ts`.
 */
export function createOperationCommand(flow: FlowSpec) {
  class OperationCommand extends BaseCommand {
    static summary = flow.description;
    static examples = flow.examples ? [...flow.examples] : [];

    // Cast: composeFlagsForFlow returns Record<string, unknown> because the
    // FlagSet is heterogeneous (string / boolean / integer flags). Runtime
    // values are real oclif Flag objects — the cross-block collision test
    // in `03-definitions/02-flows/03-compose/01-flag-set/` asserts that.
    static flags = composeFlagsForFlow(flow, getCatalog(), Models.list()) as never;

    async run() {
      const { flags } = await this.parse(this.constructor as typeof OperationCommand);
      await runOperation(flow, flags as Record<string, unknown>, this.deps);
    }
  }

  return OperationCommand;
}
