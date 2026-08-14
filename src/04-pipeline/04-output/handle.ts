/**
 * Output layer entry point — orchestrates all post-execution concerns.
 *
 * Flow: display → download → drive save → history → extras
 * Non-critical failures (Drive, download) are warnings, not errors.
 */

import type { OutputDeps } from '#root/deps.ts';
import type { ExecutionResult, OutputConfig } from '#root/types.ts';
import type { HistoryEntry } from '#services/history.ts';
import { appendHistory } from '#services/history.ts';
import { displayCancelledResult, displayFailedResult, displayResult, displayTimeoutResult } from './display.ts';
import { downloadToDir } from './download.ts';
import type { DriveContext } from './drive.ts';
import { saveToDrive } from './drive.ts';
import { runExtras } from './extras.ts';

export type { DriveContext } from './drive.ts';

/**
 * Handle all output concerns for an execution result.
 * Commands call this once — it handles display, download, drive save, history, extras.
 */
export async function handleOutput(
  result: ExecutionResult,
  config: OutputConfig,
  deps: OutputDeps,
  driveCtx?: DriveContext,
): Promise<void> {
  const displayOpts = {
    jsonMode: config.jsonMode,
    quietMode: config.quietMode,
    plainMode: config.plainMode,
  };

  // 1. Display
  if (result.status === 'completed') {
    displayResult(result, displayOpts, deps);
  } else if (result.status === 'cancelled') {
    displayCancelledResult(result, displayOpts, deps);
  } else if (result.status === 'timeout') {
    displayTimeoutResult(result, displayOpts, deps);
  } else {
    displayFailedResult(result, displayOpts, deps);
  }

  // Text/LLM results have no media URL — display is the whole story.
  // Skip download / Drive save; history below still records the prompt.
  const isTextResult = result.text != null;

  // 2. Download all results (completed only)
  if (!isTextResult && result.status === 'completed' && config.download) {
    const urls =
      result.results && result.results.length > 0 ? result.results.map((r) => r.url) : result.url ? [result.url] : [];
    for (const url of urls) {
      try {
        await downloadToDir(url, config.download, deps);
      } catch (e) {
        deps.out.error(`Download failed: ${(e as Error).message}`);
      }
    }
  }

  // 3. Drive save all results (completed only, when DriveContext provided)
  if (!isTextResult && result.status === 'completed' && config.driveSave && driveCtx) {
    if (result.results && result.results.length > 1) {
      // Save each result individually
      for (const item of result.results) {
        const singleResult: ExecutionResult = {
          ...result,
          url: item.url,
          results: [item],
        };
        await saveToDrive(singleResult, driveCtx, deps);
      }
    } else {
      await saveToDrive(result, driveCtx, deps);
    }
  }

  // 4. History (always — even failures and cancellations)
  // Record each result URL separately for multi-result generations
  const resultUrls =
    result.results && result.results.length > 0 ? result.results.map((r) => r.url) : result.url ? [result.url] : [];
  const historyEntry: HistoryEntry = {
    timestamp: new Date().toISOString(),
    model: result.model.id,
    modelName: result.model.name,
    prompt: (result.params as Record<string, unknown>).prompt as string | undefined,
    params: result.params,
    resultUrl: resultUrls[0],
    rawResultUrl: resultUrls[0],
    resultUrls: resultUrls.length > 1 ? resultUrls : undefined,
    durationMs: result.durationMs,
    status:
      result.status === 'completed'
        ? 'completed'
        : result.status === 'timeout'
          ? 'timeout'
          : result.status === 'cancelled'
            ? 'cancelled'
            : 'failed',
    error: result.error,
  };
  try {
    appendHistory(historyEntry);
  } catch {
    /* history write failure is non-critical */
  }

  // 5. Extras (clipboard, open, bell, notify, preview)
  await runExtras(result, config, deps);
}
