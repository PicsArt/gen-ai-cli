/**
 * Build OutputConfig from flags + user config defaults.
 */

import type { OutputConfig } from '#root/types.ts';
import { resolveUserPath } from '#services/constants.ts';
import type { UserConfig } from '#services/user-config.ts';

export function buildOutputConfig(
  flags: Record<string, unknown>,
  config: UserConfig,
  modeFlags: { json: boolean; quiet: boolean; plain: boolean },
): OutputConfig {
  const clipboard = (flags.clipboard as boolean) || (config.autoClipboard ?? false);
  const bell = (flags.bell as boolean) || (config.autoBell ?? false);
  const notify = (flags.notify as boolean) || (config.autoNotify ?? false);
  const open = flags.open != null ? (flags.open as boolean) : (config.autoOpen ?? false);

  let download: string | undefined;
  if (flags['no-download']) {
    download = undefined;
  } else if (flags.download) {
    download = resolveUserPath(flags.download as string);
  } else if (config.downloadDir) {
    download = resolveUserPath(config.downloadDir);
  } else {
    download = './output';
  }

  return {
    download,
    driveSave: (flags['save-to-drive'] as boolean) ?? true,
    driveFolder: (flags['drive-folder'] as string) ?? 'gen-ai-cli',
    open,
    clipboard,
    bell,
    notify,
    jsonMode: modeFlags.json,
    quietMode: modeFlags.quiet,
    plainMode: modeFlags.plain,
  };
}
