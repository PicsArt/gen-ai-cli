/**
 * Output display — renders execution results to the terminal.
 * Supports rich (branded card), JSON, quiet (URL only), and plain modes.
 */

import { renderCard } from '#infra/ui-core/components/card.ts';
import { renderKeyValue } from '#infra/ui-core/components/key-value.ts';
import type { OutputDeps } from '#root/deps.ts';
import type { ExecutionResult } from '#root/types.ts';

interface DisplayOptions {
  jsonMode: boolean;
  quietMode: boolean;
  plainMode: boolean;
}

function formatElapsed(ms: number): string {
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  return `${mins}m ${remSecs}s`;
}

/**
 * Display a text/LLM result. The generated text always goes to stdout via
 * `result()` so it stays pipeable; rich mode adds a model/time header on
 * stderr. Returns true if the result was a text result (and handled).
 */
function displayTextResult(result: ExecutionResult, options: DisplayOptions, deps: OutputDeps): boolean {
  if (result.text == null) return false;

  if (options.jsonMode) {
    deps.out.json({ text: result.text, model: result.model.id, durationMs: result.durationMs });
    return true;
  }

  if (!options.quietMode) {
    const elapsed = formatElapsed(result.durationMs);
    process.stderr.write(
      `${renderCard(
        [
          ...renderKeyValue(
            [
              ['Model', result.model.name],
              ['Time', elapsed],
            ],
            { color: deps.color },
          ).split('\n'),
        ],
        {
          color: deps.color,
          title: '✓ Response',
          borderColor: '#64ED68',
          maxWidth: process.stdout.columns || 120,
          plain: options.plainMode,
        },
      )}\n`,
    );
  }

  deps.out.result(result.text);
  return true;
}

/** Display a successful generation result. */
export function displayResult(result: ExecutionResult, options: DisplayOptions, deps: OutputDeps): void {
  if (displayTextResult(result, options, deps)) return;

  if (options.jsonMode) {
    deps.out.json({
      url: result.url,
      model: result.model.id,
      results: result.results,
      durationMs: result.durationMs,
    });
    return;
  }

  if (options.quietMode) {
    if (result.url) deps.out.result(result.url);
    return;
  }

  // Rich mode — branded card
  const elapsed = formatElapsed(result.durationMs);
  const kvPairs: [string, string][] = [['Model', result.model.name]];
  if (elapsed) kvPairs.push(['Time', elapsed]);
  const results = result.results ?? [];
  if (results.length > 1) kvPairs.push(['Results', `${results.length} items`]);

  const links: string[] = [];
  for (const item of results) {
    if (item.url) {
      links.push(deps.color.link(item.url, item.url));
      // Multi-result models (Recraft Explore) tag each output with an
      // `exploreImageId`. Print it on its own indented line — appending
      // it inline would get truncated by the card's max-width on the
      // long CDN URLs and the ID is what users actually need to copy
      // for `--source-image-id` follow-ups.
      if (item.exploreImageId) {
        links.push(`  ${deps.color.dim(`id: ${item.exploreImageId}`)}`);
      }
    }
  }

  const cardLines = [...renderKeyValue(kvPairs, { color: deps.color }).split('\n'), '', ...links];
  process.stderr.write(
    `${renderCard(cardLines, {
      color: deps.color,
      title: '\u2713 Generation Complete',
      borderColor: '#64ED68',
      maxWidth: process.stdout.columns || 120,
      plain: options.plainMode,
    })}\n`,
  );

  if (result.url) deps.out.success(`Result: ${result.url}`);
}

/** Display a failed generation result. */
export function displayFailedResult(result: ExecutionResult, options: DisplayOptions, deps: OutputDeps): void {
  if (options.jsonMode) {
    deps.out.json({
      error: result.error,
      model: result.model.id,
      durationMs: result.durationMs,
    });
    return;
  }

  deps.out.error(`Generation failed: ${result.error ?? 'unknown error'}`);
}

/** Display a cancelled result. */
export function displayCancelledResult(_result: ExecutionResult, _options: DisplayOptions, deps: OutputDeps): void {
  deps.out.info('Generation cancelled');
}

/** Display a polling-timeout result. Job is alive server-side; surface taskId + hint. */
export function displayTimeoutResult(result: ExecutionResult, options: DisplayOptions, deps: OutputDeps): void {
  if (options.jsonMode) {
    deps.out.json({
      error: result.error,
      taskId: result.taskId,
      model: result.model.id,
      durationMs: result.durationMs,
      status: 'timeout',
    });
    return;
  }
  deps.out.warn(`Generation still running. Task id: ${result.taskId ?? 'unknown'}`);
  if (result.error) deps.out.info(result.error);
  deps.out.info('Tip: `gen-ai history` will show the latest entry once it finishes.');
}
