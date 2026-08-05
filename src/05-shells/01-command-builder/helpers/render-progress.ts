/**
 * Progress rendering for operation commands.
 */
import chalk from 'chalk';
import type { ProgressInfo } from '#root/types.ts';

function formatElapsed(ms: number): string {
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  if (mins < 60) return `${mins}m ${remSecs}s`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hrs}h ${String(remMins).padStart(2, '0')}m`;
}

function progressBar(percent: number, width = 30, elapsedMs?: number): string {
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;
  const bar = chalk.green('\u2588'.repeat(filled)) + chalk.dim('\u2591'.repeat(empty));
  const elapsed = elapsedMs != null ? ` ${chalk.dim(`(${formatElapsed(elapsedMs)})`)}` : '';
  return `${bar} ${percent.toFixed(0)}%${elapsed}`;
}

export function createProgressHandler(spinner: { text: string }): (progress: ProgressInfo) => void {
  const s = spinner;
  return (progress: ProgressInfo) => {
    if (progress.percent != null) {
      s.text = progressBar(progress.percent, 30, progress.elapsed);
    } else {
      const elapsedStr = formatElapsed(progress.elapsed);
      s.text = `${progress.status}... ${chalk.dim(`(${elapsedStr})`)}`;
    }
  };
}
