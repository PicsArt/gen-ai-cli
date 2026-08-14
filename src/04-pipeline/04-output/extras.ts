/**
 * Output extras — clipboard, open in app, bell, desktop notification.
 * Wraps utils/ functions with OutputDeps for info messages.
 */

import { copyToClipboard } from '#infra/utils/clipboard.ts';
import { bell, openInDefault, sendNotification } from '#infra/utils/open.ts';
import { previewUrl, supportsInlineImages } from '#infra/utils/terminal-image.ts';
import type { OutputDeps } from '#root/deps.ts';
import type { ExecutionResult, OutputConfig } from '#root/types.ts';

/**
 * Run all post-display extras based on OutputConfig.
 */
export async function runExtras(result: ExecutionResult, config: OutputConfig, deps: OutputDeps): Promise<void> {
  if (result.status !== 'completed' || !result.url) {
    // For failed/cancelled: only bell and notify
    if (config.bell) bell();
    if (config.notify) {
      const msg =
        result.status === 'cancelled'
          ? 'Generation cancelled'
          : result.status === 'timeout'
            ? `Generation still running. Task id: ${result.taskId ?? 'unknown'}`
            : `Generation failed: ${result.error ?? 'unknown'}`;
      sendNotification('gen-ai', msg);
    }
    return;
  }

  // Image preview in terminal — `config set imagePreview false` opts out.
  if (config.imagePreview !== false && result.model.mode === 'image' && supportsInlineImages()) {
    try {
      await previewUrl(result.url, 'result');
    } catch {
      /* preview is optional */
    }
  }

  // Clipboard
  if (config.clipboard && copyToClipboard(result.url)) {
    deps.out.info('URL copied to clipboard');
  }

  // Open in default app
  if (config.open) {
    openInDefault(result.url);
  }

  // Bell and notification
  if (config.bell) bell();
  if (config.notify) {
    sendNotification('gen-ai', `${result.model.name} generation complete`);
  }
}
