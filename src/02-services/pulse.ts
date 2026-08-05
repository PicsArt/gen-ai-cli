/**
 * Pulse analytics tracker — CLI integration.
 *
 * Wraps @pulse/server's createClient with our app name + version. Used from the
 * process entry point (src/index.ts) to set up an AsyncLocalStorage context for
 * the entire CLI lifecycle. Inside that context, any module can
 *
 *   import { pulse } from '@pulse/core';
 *   pulse.event({ event: 'foo', data: { ... } });
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
import { loadCredentials } from './auth.ts';
import { getDeviceId } from './device-id.ts';

/**
 * Pulse app name. Drives both the wire `header.app` field and the device-id
 * storage path (~/Library/Application Support/pulse-cli-sdk/<app>/device-id).
 */
const PULSE_APP_NAME = 'gen-ai';

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
    const creds = loadCredentials();
    if (creds?.uid) {
      state.user_id = creds.uid;
    }
  } catch {
    /* anonymous session is fine */
  }

  return state;
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

  try {
    const { pulse } = await import('@pulse/core');
    const drained = pulse.flush();
    const timer = new Promise<void>((resolve) => {
      setTimeout(resolve, timeoutMs).unref();
    });
    await Promise.race([drained, timer]);
  } catch {
    // Telemetry never breaks the host.
  }
}
