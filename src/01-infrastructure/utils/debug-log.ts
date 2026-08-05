import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getDataDir } from '#infra/utils/data-dir.ts';

const LOG_FILE = 'debug.log';
const MAX_SIZE = 1_000_000; // 1MB
const MAX_ENTRIES = 5;

interface DebugEntry {
  timestamp: string;
  cliVersion: string;
  nodeVersion: string;
  os: string;
  command: string;
  error: string;
  stack?: string;
}

export function writeDebugLog(entry: { cliVersion: string; command: string; error: string; stack?: string }): string {
  const full: DebugEntry = {
    ...entry,
    timestamp: new Date().toISOString(),
    nodeVersion: process.version,
    os: `${os.platform()} ${os.arch()} ${os.release()}`,
  };

  const dataDir = getDataDir();
  const logPath = path.join(dataDir, LOG_FILE);

  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });

  let entries: DebugEntry[] = [];
  try {
    const raw = fs.readFileSync(logPath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) entries = parsed;
  } catch {
    /* file missing or corrupted — start fresh */
  }

  entries.push(full);
  if (entries.length > MAX_ENTRIES) entries = entries.slice(-MAX_ENTRIES);
  const json = JSON.stringify(entries, null, 2);
  if (json.length > MAX_SIZE) entries = entries.slice(-1);

  fs.writeFileSync(logPath, JSON.stringify(entries, null, 2), { mode: 0o600 });
  return logPath;
}
