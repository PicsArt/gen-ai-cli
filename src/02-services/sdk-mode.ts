/**
 * The process's @picsart/ai-sdk catalog mode — static (the bundled catalog) or
 * dynamic (the models-hub catalog, loaded at boot by sdk-catalog.ts).
 *
 * The SDK forbids mixing modes in one process: its loaded catalog is
 * process-global and carries no payload builders, so a static client created
 * after a dynamic one would build invalid vendor payloads. The mode is fixed
 * once, at boot, before any client exists; every client goes through
 * `createSdkClient()` in client.ts, which reads it from here.
 */
import type { SdkMode } from '@picsart/ai-sdk';
import { UsageError } from '#infra/errors/usage.ts';

let _mode: SdkMode | null = null;

/** The fixed mode, or `'static'` before boot (tests, and anything that never boots). */
export function getSdkMode(): SdkMode {
  return _mode ?? 'static';
}

export function isDynamicSdk(): boolean {
  return _mode === 'dynamic';
}

export function isSdkModeResolved(): boolean {
  return _mode !== null;
}

/** Fix the mode for this process. Setting it again to a different value throws. */
export function setSdkMode(mode: SdkMode): void {
  if (_mode !== null && _mode !== mode) {
    throw new UsageError(`SDK catalog mode is already "${_mode}" for this process; cannot switch to "${mode}".`);
  }
  _mode = mode;
}

/**
 * The mode the user asked for: `GEN_AI_SDK_MODE=static` pins the bundled
 * catalog, anything else (unset included) asks for dynamic. Boot still falls
 * back to static when the remote catalog cannot be had.
 */
export function requestedSdkMode(env: NodeJS.ProcessEnv = process.env): SdkMode {
  return env.GEN_AI_SDK_MODE?.trim().toLowerCase() === 'static' ? 'static' : 'dynamic';
}

/** Test-only: forget the fixed mode. */
export function resetSdkModeForTests(): void {
  _mode = null;
}
