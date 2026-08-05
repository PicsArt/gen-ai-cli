/**
 * Duration-string parser for `--poll-timeout` and similar flags.
 *
 * Accepts: "30s", "30m", "1h", or a bare integer (interpreted as minutes).
 * Returns milliseconds. Throws UsageError on anything else.
 */
import { UsageError } from '#infra/errors/usage.ts';

const SUFFIXED = /^(\d+)\s*(s|m|h)$/i;
const BARE_INT = /^\d+$/;

export function parseDuration(input: string): number {
  const trimmed = input.trim();
  let ms: number | undefined;

  if (BARE_INT.test(trimmed)) {
    ms = Number(trimmed) * 60_000; // bare integer = minutes
  } else {
    const match = SUFFIXED.exec(trimmed);
    if (match) {
      const n = Number(match[1]);
      const unit = match[2].toLowerCase();
      ms = unit === 's' ? n * 1000 : unit === 'm' ? n * 60_000 : n * 3_600_000;
    }
  }

  if (ms === undefined || !Number.isFinite(ms) || ms <= 0) {
    throw new UsageError(
      `Invalid duration: "${input}". Expected forms: "30s", "30m", "1h", or a bare integer (minutes).`,
    );
  }
  return ms;
}
