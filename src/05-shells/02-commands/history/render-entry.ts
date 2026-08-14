/**
 * Shared rendering for a single history entry — used by both the
 * `history last` detail view and the interactive `history` browser.
 */
import type { ColorManager } from '#infra/ui-core/color.ts';
import { renderKeyValue } from '#infra/ui-core/components/key-value.ts';
import type { HistoryEntry } from '#services/history.ts';

export function formatElapsed(ms: number): string {
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  if (mins < 60) return `${mins}m ${remSecs}s`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hrs}h ${String(remMins).padStart(2, '0')}m`;
}

/** Build the detail-card body lines for one generation entry. */
export function buildEntryDetailLines(entry: HistoryEntry, color: ColorManager): string[] {
  const statusLabel =
    entry.status === 'completed'
      ? color.green('completed')
      : entry.status === 'cancelled'
        ? color.dim('cancelled')
        : color.red(entry.status === 'timeout' ? 'timeout' : 'failed');

  const pairs: [string, string][] = [];
  if (entry.id) pairs.push(['Id', entry.id]);
  pairs.push(
    ['Model', `${entry.modelName ?? entry.model} (${entry.model})`],
    ['Prompt', entry.prompt ?? '(none)'],
    ['Status', statusLabel],
  );

  if (entry.resultUrl) pairs.push(['Result', entry.resultUrl]);
  if (entry.resultUrls && entry.resultUrls.length > 1) {
    pairs.push(['Results', `${entry.resultUrls.length} items`]);
  }
  if (entry.durationMs) pairs.push(['Duration', formatElapsed(entry.durationMs)]);
  pairs.push(['Time', entry.timestamp]);
  if (entry.error) pairs.push(['Error', entry.error]);
  if (Object.keys(entry.params).length > 0) pairs.push(['Params', JSON.stringify(entry.params)]);

  return renderKeyValue(pairs, { color }).split('\n');
}
