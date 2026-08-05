/**
 * Dependency interfaces for the layered pipeline.
 *
 * Each layer receives only the dependencies it needs — enforced by types.
 * The execution layer gets no UI. The output layer gets no resolvers.
 */

import { CLI_VERSION } from '#services/constants.ts';
import type { UserConfig } from '#services/user-config.ts';
import type { ColorManager } from './01-infrastructure/ui-core/color.ts';
import type { OutputManager } from './01-infrastructure/ui-core/output.ts';
import { getLocaleInfo } from './01-infrastructure/utils/locale.ts';
import { getSessionId } from './01-infrastructure/utils/session-id.ts';
import { getDeviceId } from './02-services/device-id.ts';

/* ── Analytics context (stable for the process lifetime) ─────── */

export interface AnalyticsContext {
  version: string;
  sessionId: string;
  deviceId: string;
  countryCode: string;
  timezone: string;
  locale: string;
}

let cachedAnalytics: AnalyticsContext | undefined;

export function getAnalyticsContext(): AnalyticsContext {
  if (cachedAnalytics) return cachedAnalytics;
  const { countryCode, timezone, locale } = getLocaleInfo();
  cachedAnalytics = {
    version: CLI_VERSION,
    sessionId: getSessionId(),
    deviceId: getDeviceId(),
    countryCode,
    timezone,
    locale,
  };
  return cachedAnalytics;
}

/* ── Full CLI deps (Command layer) ───────────────────────────── */

export interface CliFlags {
  quiet: boolean;
  debug: boolean;
  json: boolean;
  plain: boolean;
  noInput: boolean;
}

export interface CliDeps {
  color: ColorManager;
  out: OutputManager;
  config: UserConfig;
  flags: CliFlags;
  analytics: AnalyticsContext;
}

export function createCliDeps(opts: {
  color: ColorManager;
  out: OutputManager;
  config: UserConfig;
  flags: CliFlags;
}): CliDeps {
  return {
    color: opts.color,
    out: opts.out,
    config: opts.config,
    flags: opts.flags,
    analytics: getAnalyticsContext(),
  };
}

/* ── Execution deps (no UI) ──────────────────────────────────── */

export interface ExecutionDeps {
  apiUrl: string;
  uploadUrl: string;
  authenticatedFetch: typeof fetch;
}

export function toExecutionDeps(opts: {
  apiUrl: string;
  uploadUrl: string;
  authenticatedFetch: typeof fetch;
}): ExecutionDeps {
  return {
    apiUrl: opts.apiUrl,
    uploadUrl: opts.uploadUrl,
    authenticatedFetch: opts.authenticatedFetch,
  };
}

/* ── Output deps (UI + network, no resolvers) ────────────────── */

export interface OutputDeps {
  color: ColorManager;
  out: OutputManager;
  authenticatedFetch: typeof fetch;
  uploadUrl: string;
}

export function toOutputDeps(
  cliDeps: CliDeps,
  network: { authenticatedFetch: typeof fetch; uploadUrl: string },
): OutputDeps {
  return {
    color: cliDeps.color,
    out: cliDeps.out,
    authenticatedFetch: network.authenticatedFetch,
    uploadUrl: network.uploadUrl,
  };
}
