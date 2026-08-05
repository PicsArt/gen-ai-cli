/**
 * Clipboard utilities — read/write text + detect & extract images from clipboard.
 * Uses spawnSync (no shell) for safety.
 * Supports macOS (pbcopy/pbpaste/osascript) and Linux (xclip/xsel).
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/** Copy text to system clipboard. */
export function copyToClipboard(text: string): boolean {
  try {
    if (process.platform === 'darwin') {
      const r = spawnSync('pbcopy', [], { input: text, timeout: 3000 });
      return r.status === 0;
    }
    // Try xclip first, then xsel
    const xclip = spawnSync('xclip', ['-selection', 'clipboard'], { input: text, timeout: 3000 });
    if (xclip.status === 0) return true;
    const xsel = spawnSync('xsel', ['--clipboard', '--input'], { input: text, timeout: 3000 });
    return xsel.status === 0;
  } catch {
    return false;
  }
}

/** Check if clipboard contains an image. */
export function hasClipboardImage(): boolean {
  try {
    if (process.platform === 'darwin') {
      const result = spawnSync('osascript', ['-e', 'clipboard info'], { encoding: 'utf-8', timeout: 3000 });
      return result.stdout?.includes('«class PNGf»') || result.stdout?.includes('«class TIFF»') || false;
    }
    // Linux: check xclip targets
    const result = spawnSync('xclip', ['-selection', 'clipboard', '-t', 'TARGETS', '-o'], {
      encoding: 'utf-8',
      timeout: 3000,
    });
    return result.stdout?.includes('image/png') || false;
  } catch {
    return false;
  }
}

/** Extract clipboard image to a temp file. Returns the temp file path or null. */
export function extractClipboardImage(): string | null {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-ai-paste-'));
  const tmpFile = path.join(tmpDir, 'clipboard.png');

  try {
    if (process.platform === 'darwin') {
      // Use osascript to write PNG data from clipboard to a file
      const safePath = tmpFile.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      const script = [
        'set pngData to the clipboard as «class PNGf»',
        `set filePath to POSIX file "${safePath}"`,
        'set fileRef to open for access filePath with write permission',
        'write pngData to fileRef',
        'close access fileRef',
      ].join('\n');
      const result = spawnSync('osascript', ['-e', script], { encoding: 'utf-8', timeout: 5000 });
      if (result.status !== 0) {
        // Try pngpaste as fallback (brew install pngpaste)
        const fallback = spawnSync('pngpaste', [tmpFile], { encoding: 'utf-8', timeout: 5000 });
        if (fallback.status !== 0) {
          try {
            fs.rmSync(tmpDir, { recursive: true, force: true });
          } catch {
            /* ignore */
          }
          return null;
        }
      }
    } else {
      // Linux: xclip outputs image data to stdout
      const result = spawnSync('xclip', ['-selection', 'clipboard', '-t', 'image/png', '-o'], { timeout: 5000 });
      if (result.status !== 0 || !result.stdout?.length) {
        try {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch {
          /* ignore */
        }
        return null;
      }
      fs.writeFileSync(tmpFile, result.stdout);
    }

    // Verify the file was created and has content
    if (fs.existsSync(tmpFile) && fs.statSync(tmpFile).size > 0) {
      // Schedule cleanup on process exit so temp files don't accumulate
      process.once('exit', () => {
        try {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch {
          /* ignore */
        }
      });
      return tmpFile;
    }
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    return null;
  } catch {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    return null;
  }
}

/** Read text from clipboard. */
export function readClipboardText(): string | null {
  try {
    if (process.platform === 'darwin') {
      const r = spawnSync('pbpaste', [], { encoding: 'utf-8', timeout: 3000 });
      return r.stdout?.trim() || null;
    }
    const xclip = spawnSync('xclip', ['-selection', 'clipboard', '-o'], { encoding: 'utf-8', timeout: 3000 });
    if (xclip.status === 0) return xclip.stdout?.trim() || null;
    const xsel = spawnSync('xsel', ['--clipboard', '--output'], { encoding: 'utf-8', timeout: 3000 });
    return xsel.stdout?.trim() || null;
  } catch {
    return null;
  }
}
