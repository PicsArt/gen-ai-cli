/**
 * User configuration — persistent preferences stored in ~/.gen-ai/config.json.
 * Supports defaults for common flags like model, download dir, auto-open, etc.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ensureDataDir, getDataDir } from '#infra/utils/data-dir.ts';

export interface UserConfig {
  defaultModel?: string;
  downloadDir?: string;
  autoOpen?: boolean;
  autoClipboard?: boolean;
  autoBell?: boolean;
  autoNotify?: boolean;
  recentFilesCount?: number;
  imagePreview?: boolean;
  autoUpdate?: boolean;
}

export type SetConfigResult = { ok: true } | { ok: false; reason: string };

// Compile-time exhaustiveness check: every UserConfig key must appear in this record.
// Adding a new key to UserConfig without updating this map causes a type error.
const CONFIG_KEY_MAP: Record<keyof UserConfig, 'string' | 'boolean' | 'number'> = {
  defaultModel: 'string',
  downloadDir: 'string',
  autoOpen: 'boolean',
  autoClipboard: 'boolean',
  autoBell: 'boolean',
  autoNotify: 'boolean',
  recentFilesCount: 'number',
  imagePreview: 'boolean',
  autoUpdate: 'boolean',
};

const CONFIG_KEYS = Object.keys(CONFIG_KEY_MAP) as (keyof UserConfig)[];

function getConfigPath(): string {
  return path.join(getDataDir(), 'config.json');
}

const CONFIG_DEFAULTS: Partial<UserConfig> = {
  autoUpdate: true,
};

/** Load user config with runtime type validation. Returns defaults for missing keys. */
export function getUserConfig(): UserConfig {
  try {
    const raw = fs.readFileSync(getConfigPath(), 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const config: Record<string, unknown> = {};
    for (const key of CONFIG_KEYS) {
      const value = parsed[key];
      if (value == null) continue;
      const expected = CONFIG_KEY_MAP[key];
      if (expected === 'boolean' && typeof value !== 'boolean') continue;
      if (expected === 'number' && typeof value !== 'number') continue;
      if (expected === 'string' && typeof value !== 'string') continue;
      config[key] = value;
    }
    return { ...CONFIG_DEFAULTS, ...config } as UserConfig;
  } catch {
    return { ...CONFIG_DEFAULTS } as UserConfig;
  }
}

/** Save full config. */
export function saveUserConfig(config: UserConfig): void {
  ensureDataDir();
  const dest = getConfigPath();
  const tmp = `${dest}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, dest);
}

/** Set a single config key. */
export function setConfigValue(key: string, value: string): SetConfigResult {
  if (!(key in CONFIG_KEY_MAP)) {
    return { ok: false, reason: `Unknown key: ${key}` };
  }
  const config = getUserConfig();
  const k = key as keyof UserConfig;
  const type = CONFIG_KEY_MAP[k];

  if (type === 'boolean') {
    // Strict parse — silently mapping any unrecognized string to `false`
    // turns a typo ("yes", "ture") into the opposite of what the user meant.
    const lower = value.trim().toLowerCase();
    if (lower === 'true' || lower === '1' || lower === 'yes' || lower === 'on') {
      (config as Record<string, unknown>)[k] = true;
    } else if (lower === 'false' || lower === '0' || lower === 'no' || lower === 'off') {
      (config as Record<string, unknown>)[k] = false;
    } else {
      return { ok: false, reason: `${key} must be true or false (got "${value}")` };
    }
  } else if (type === 'number') {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 500) {
      return { ok: false, reason: `${key} must be an integer between 1 and 500` };
    }
    (config as Record<string, unknown>)[k] = parsed;
  } else {
    if (k === 'downloadDir') {
      if (!value || !path.isAbsolute(value)) {
        return { ok: false, reason: `downloadDir must be an absolute path` };
      }
    }
    (config as Record<string, unknown>)[k] = value;
  }

  saveUserConfig(config);
  return { ok: true };
}

/** Delete a config key (revert to default). */
export function unsetConfigValue(key: string): boolean {
  if (!(key in CONFIG_KEY_MAP)) return false;
  const config = getUserConfig();
  delete (config as Record<string, unknown>)[key];
  saveUserConfig(config);
  return true;
}

/** Get all valid config keys. */
export function getConfigKeys(): string[] {
  return [...CONFIG_KEYS];
}
