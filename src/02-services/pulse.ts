/**
 * Pulse analytics tracker — CLI integration.
 *
 * Wraps @pulse/server's createClient with our app name + version. Used from the
 * process entry point (src/index.ts) to set up an AsyncLocalStorage context for
 * the entire CLI lifecycle. Inside that context, any module can
 *
 *   import { pulse } from '@pulse/core';
 *   pulse.event({ event_type: 'foo', data: { ... } });
 *
 * and the proxy resolves to this tracker. No deps to thread through call sites.
 *
 * Caller responsibilities:
 *   - call createPulseClient() ONCE per process
 *   - wrap the program in client.createAsyncContext({}, fn) and apply
 *     getInitialPulseState() via pulse.set() INSIDE the context (see below —
 *     passing it as the createAsyncContext init silently drops custom keys)
 *   - await pulse.flush() before process exit (the SDK's beforeExit safety net
 *     does NOT fire on explicit process.exit()).
 *
 * Honors these env vars (consumer-side convention; SDK doesn't read them):
 *   PULSE_OPT_OUT=1   short-circuit: caller skips the wrap entirely
 *   PULSE_SERVER_URL  override the server endpoint (local capture / dev)
 *
 * Telemetry is fire-and-forget — the SDK swallows transport errors internally
 * so a Pulse outage can never break the CLI.
 */

import { createRequire } from 'node:module';
import type { PulseClient } from '@pulse/server';
import { createClient } from '@pulse/server';
import { getLocaleInfo } from '#infra/utils/locale.ts';
import { getSessionId } from '#infra/utils/session-id.ts';
import { getEnvCredentials, loadCredentials } from './auth.ts';
import { getDeviceId } from './device-id.ts';

/**
 * Pulse app name. Drives both the wire `header.app` field and the device-id
 * storage path (~/Library/Application Support/pulse-cli-sdk/<app>/device-id).
 *
 * Reverse-DNS identifier registered on the Pulse receiver — the analytics
 * platform keys events by this exact string, so it must match the registered
 * app id (`com.picsart.apps.cli`), not the CLI's npm/bin name (`gen-ai`).
 */
const PULSE_APP_NAME = 'com.picsart.apps.cli';

/**
 * Pulse SDK version — required by TrackerServerConfiguration, lands on the
 * wire as `header.v`. Read at module load from @pulse/server's own
 * package.json so it stays accurate across upgrades.
 */
const PULSE_SDK_VERSION: string = (() => {
  try {
    const require = createRequire(import.meta.url);
    const pkg = require('@pulse/server/package.json') as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
})();

export interface CreatePulseClientOptions {
  /** App version — lands on the wire as header.version. Pass the resolved CLI version. */
  appVersion: string;
}

/**
 * Build the Pulse client. Pure factory — no side effects until createAsyncContext.
 */
export function createPulseClient(opts: CreatePulseClientOptions): PulseClient {
  const serverBaseURL = process.env.PULSE_SERVER_URL;
  return createClient({
    app: PULSE_APP_NAME,
    tracker: {
      appVersion: opts.appVersion,
      sdkVersion: PULSE_SDK_VERSION,
      ...(serverBaseURL ? { serverBaseURL } : {}),
    },
  });
}

/**
 * Initial state applied on every event header for this process invocation.
 *
 * MUST be applied via `pulse.set(...)` inside the async context — NOT passed
 * as the `createAsyncContext` init. PulseContext whitelists init keys
 * (STATE_KEYS: deviceId, userId, country, ...) and silently drops everything
 * else, so none of these snake_case keys would survive. `pulse.set()` copies
 * keys into the tracker's headerExtras, which land on the wire verbatim.
 *
 * Pulse already populates `header.device_id` and `header.session_id` itself
 * (its own UUID format, stored under ~/Library/Application Support/...). We
 * attach the CLI's own analytics identifiers under distinct keys so both
 * systems can coexist and analytics queries can join across them.
 *
 *   header.device_id      ← Pulse's own (a.c.<base36>.<uuid> format)
 *   header.session_id     ← Pulse's own (memory-only)
 *   header.app_device_id  ← gen-ai CLI's UUIDv4 from ~/.gen-ai/device-id
 *   header.app_session_id ← gen-ai CLI's UUIDv7 (time-ordered)
 *   header.country_code   ← ISO-3166 from locale
 *   header.timezone       ← IANA timezone
 *   header.locale_code    ← BCP-47 locale string
 *   header.user_id        ← uid from credentials when logged in
 *
 * Filesystem / env / credential failures all degrade silently — analytics
 * setup must never block CLI startup.
 */
export function getInitialPulseState(): Record<string, unknown> {
  const state: Record<string, unknown> = {};

  try {
    state.app_device_id = getDeviceId();
  } catch {
    /* device-id file unreadable — Pulse's own device_id still goes on the wire */
  }

  try {
    state.app_session_id = getSessionId();
  } catch {
    /* crypto unavailable (extremely unlikely) — skip the field */
  }

  try {
    const { countryCode, timezone, locale } = getLocaleInfo();
    state.country_code = countryCode;
    state.timezone = timezone;
    state.locale_code = locale;
  } catch {
    /* locale detection failed — skip */
  }

  try {
    // Same precedence as getToken: env credentials (CI mode) win over the
    // file — env-authenticated runs must not ship events without a user_id.
    const creds = getEnvCredentials() ?? loadCredentials();
    if (creds?.uid) {
      state.user_id = creds.uid;
    }
  } catch {
    /* anonymous session is fine */
  }

  return state;
}

/**
 * The two literal first arguments @pulse/common's `objectDeepClone()` passes to
 * `console.warn` on its clone-fallback path. Copied verbatim from
 * `node_modules/@pulse/common/esm/utils/obj-clone.js` — an inexact copy would
 * silently stop matching and let the leak through.
 */
const PULSE_CLONE_WARNINGS: readonly string[] = [
  'structuredClone failed, falling back to deepClonePruningNonStructured',
  'Deep clone failed using JSON fallback.',
];

/**
 * Silence @pulse/common's clone-fallback `console.warn` for the lifetime of a
 * Pulse-enabled run. Returns a restore function.
 *
 * WHY THIS EXISTS — SDK bug, not an application bug:
 * `tracker.set()` calls `objectDeepClone()` on the tracker's own state, which
 * the SDK itself has wrapped in an `observeObject` Proxy. `structuredClone`
 * always throws on a Proxy, so `objectDeepClone` takes its fallback path and
 * logs `console.warn(<message>, <the whole tracker state>)`. That second
 * argument contains real identifiers (`userId`, `appDeviceId`,
 * `appSessionId`), so every single CLI invocation printed ~26 lines of
 * user/device data to stderr. Nothing is being hidden by this filter: the
 * fallback clone (`deepClonePruningNonStructured`) produces a correct clone —
 * the warning is a purely diagnostic print with no functional consequence.
 *
 * Deliberately narrow: only calls whose FIRST argument is exactly one of the
 * two known SDK strings are dropped. Every other `console.warn` — from this
 * SDK or anywhere else — passes through untouched, and the patch is reverted
 * in a `finally` so it can never outlive the Pulse run.
 *
 * REMOVAL CONDITION: delete this once `@pulse/common` gates that warn behind a
 * debug flag or stops passing raw tracker state to `console.warn`. Not fixed as
 * of the currently-pinned `@pulse/server`/`@pulse/core` version — check for an
 * upstream fix before bumping that dependency, and drop this if it landed.
 */
function suppressPulseCloneWarnings(): () => void {
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]): void => {
    if (typeof args[0] === 'string' && PULSE_CLONE_WARNINGS.includes(args[0])) return;
    originalWarn(...args);
  };
  return () => {
    console.warn = originalWarn;
  };
}

/**
 * Convenience wrapper around the createAsyncContext + flush boilerplate.
 *
 *   await runWithPulse(version, async () => {
 *     // your program
 *   });
 *
 * Respects PULSE_OPT_OUT=1 — if set, runs `fn` without any Pulse context, so
 * `import { pulse }` calls become no-ops (the proxy has no tracker to resolve).
 */
export async function runWithPulse(appVersion: string, fn: () => Promise<void>): Promise<void> {
  if (process.env.PULSE_OPT_OUT === '1') {
    await fn();
    return;
  }

  const client = createPulseClient({ appVersion });
  const { pulse } = await import('@pulse/core');

  // Catch fatal Node-level errors that bypass normal control flow.
  // Without this, uncaught exceptions and unhandled rejections kill the
  // process before in-flight Pulse POSTs reach the network.
  let alreadyExiting = false;
  const drainAndDie = (err: unknown): void => {
    if (alreadyExiting) return;
    alreadyExiting = true;
    console.error(err);
    // Fire-and-forget: drain the buffer, then exit. We `.catch` so Biome's
    // `noVoid` is satisfied; in practice `process.exit()` inside the finally
    // tears the process down before any rejection could surface.
    (async () => {
      try {
        await pulse.flush();
      } catch {
        /* never throw on the death path */
      }
      process.exit(1);
    })().catch(() => undefined);
  };
  process.once('uncaughtException', drainAndDie);
  process.once('unhandledRejection', drainAndDie);

  // Active only while Pulse is initialized; restored below no matter how the
  // wrapped work ends. See suppressPulseCloneWarnings() for the full rationale.
  const restoreWarn = suppressPulseCloneWarnings();
  try {
    await client.createAsyncContext({}, async () => {
      // Apply header state through pulse.set() — the createAsyncContext init
      // only accepts whitelisted STATE_KEYS and drops custom keys silently.
      pulse.set(getInitialPulseState());
      try {
        await fn();
      } finally {
        // Drain in-flight POSTs before sockets are torn down. Always runs,
        // even if `fn` throws, so error analytics aren't lost.
        await pulse.flush();
      }
    });
  } finally {
    restoreWarn();
  }
}

/**
 * Drain Pulse in-flight POSTs. Call from any code path that is about to call
 * `process.exit()` or otherwise terminate the process abruptly (oclif's
 * `this.exit()`, SIGINT handlers, fatal error handlers). Returns when every
 * pending POST has either completed or its underlying error was swallowed.
 *
 * Safe to call:
 *   - when Pulse was never initialized (PULSE_OPT_OUT=1) — resolves immediately
 *   - when called multiple times — each call drains whatever is current
 *
 * Never throws, with an optional timeout cap so a hung receiver can't block
 * an exit forever. Default cap: 2 seconds.
 */
export async function flushPulse(timeoutMs = 2000): Promise<void> {
  if (process.env.PULSE_OPT_OUT === '1') return;

  let handle: ReturnType<typeof setTimeout> | undefined;
  try {
    const { pulse } = await import('@pulse/core');
    const drained = pulse.flush();
    // The timer is deliberately NOT .unref()'d: an unref'd timer cannot hold
    // the event loop open, so if `pulse.flush()` never settles (no Pulse
    // context on this entry path) Node exits *before* the race resolves —
    // skipping the caller's `this.exit(code)` and reporting success for a
    // failed command. Holding the loop keeps the caller's `await` resumable;
    // clearTimeout in the finally keeps the CLI from lingering for timeoutMs
    // once the flush wins the race.
    const timer = new Promise<void>((resolve) => {
      handle = setTimeout(resolve, timeoutMs);
    });
    await Promise.race([drained, timer]);
  } catch {
    // Telemetry never breaks the host.
  } finally {
    if (handle) clearTimeout(handle);
  }
}
