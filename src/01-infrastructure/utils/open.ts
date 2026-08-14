/**
 * Utilities for opening files/URLs in the default system application
 * and sending desktop notifications.
 */
import { spawn, spawnSync } from 'node:child_process';

/**
 * Spawn a detached helper, swallowing the async 'error' event a missing
 * binary emits (e.g. no xdg-open) — without a listener it would crash the
 * process; a try/catch around spawn() cannot catch it.
 */
function spawnDetached(command: string, args: string[]): void {
  const child = spawn(command, args, { detached: true, stdio: 'ignore' });
  child.on('error', () => {
    /* best effort */
  });
  child.unref();
}

/** Open a URL or file path in the default system application. */
export function openInDefault(target: string): void {
  try {
    if (process.platform === 'darwin') {
      spawnDetached('open', [target]);
    } else if (process.platform === 'win32') {
      // Use Start-Process with single-quoted literal to prevent PowerShell expression injection.
      // Single quotes in the target are escaped by doubling them ('').
      const escaped = target.replace(/'/g, "''");
      spawnDetached('powershell', ['-NoProfile', '-Command', `Start-Process -FilePath '${escaped}'`]);
    } else {
      spawnDetached('xdg-open', [target]);
    }
  } catch {
    /* best effort */
  }
}

/** Escape a string for safe interpolation inside AppleScript double-quoted strings. */
function escapeAppleScript(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ').replace(/\r/g, ' ').replace(/\t/g, ' ');
}

/** Send a desktop notification. */
export function sendNotification(title: string, message: string): void {
  try {
    if (process.platform === 'darwin') {
      const safeMessage = escapeAppleScript(message);
      const safeTitle = escapeAppleScript(title);
      spawnSync('osascript', ['-e', `display notification "${safeMessage}" with title "${safeTitle}"`], {
        timeout: 3000,
      });
    } else {
      spawnSync('notify-send', [title, message], { timeout: 3000 });
    }
  } catch {
    /* notification is optional */
  }
}

/** Play terminal bell. */
export function bell(): void {
  process.stdout.write('\x07');
}
