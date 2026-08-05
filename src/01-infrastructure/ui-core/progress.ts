import * as cliProgress from 'cli-progress';
import ora, { type Ora } from 'ora';
import { getColor } from './color.ts';

export interface ProgressBarOptions {
  label?: string;
  total?: number;
}

export interface ProgressBar {
  update(value: number, total?: number): void;
  stop(): void;
}

function isTTY(): boolean {
  return Boolean(process.stderr.isTTY);
}

export function createProgressBar(opts: ProgressBarOptions = {}): ProgressBar {
  const { label = 'Progress', total = 100 } = opts;
  const color = getColor();

  if (!isTTY()) {
    return {
      update() {
        /* noop */
      },
      stop() {
        /* noop */
      },
    };
  }

  const bar = new cliProgress.SingleBar({
    stream: process.stderr,
    format: `${color.dim(label)} ${color.green('{bar}')} {percentage}% | ETA: {eta_formatted} | {duration_formatted}`,
    barCompleteChar: '\u2588',
    barIncompleteChar: '\u2591',
    hideCursor: true,
    clearOnComplete: false,
    stopOnComplete: true,
  });

  bar.start(total, 0);

  return {
    update(value: number, newTotal?: number) {
      if (newTotal !== undefined) bar.setTotal(newTotal);
      bar.update(value);
    },
    stop() {
      bar.stop();
    },
  };
}

export function createSpinner(text: string, quiet = false): Ora {
  return ora({ text, spinner: 'dots', isSilent: quiet || !isTTY(), stream: process.stderr });
}
