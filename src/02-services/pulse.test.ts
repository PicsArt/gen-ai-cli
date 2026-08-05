/**
 * Spec for the Pulse analytics service.
 *
 * Contracts:
 *   createPulseClient(opts):
 *     - passes app: 'gen-ai' and the supplied appVersion
 *     - resolves and passes sdkVersion from @pulse/server's package.json
 *     - applies PULSE_SERVER_URL override when set, omits it otherwise
 *
 *   getInitialPulseState():
 *     - returns { user_id: uid } when credentials exist
 *     - returns {} when no credentials
 *     - returns {} when loadCredentials throws
 *
 *   flushPulse():
 *     - resolves immediately when PULSE_OPT_OUT=1 (no flush call)
 *     - awaits pulse.flush() under normal conditions
 *     - times out when flush hangs longer than the cap
 *     - never throws when flush rejects
 *
 *   runWithPulse(version, fn):
 *     - skips the wrap entirely when PULSE_OPT_OUT=1
 *     - wraps fn in createAsyncContext and applies the initial state via
 *       pulse.set() INSIDE the context (the createAsyncContext init only
 *       accepts whitelisted STATE_KEYS — custom keys would be dropped)
 *     - flushes after success
 *     - flushes then re-throws on error
 *     - registers fatal-error handlers (uncaughtException, unhandledRejection)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const createClientMock = vi.hoisted(() => vi.fn());
const loadCredentialsMock = vi.hoisted(() => vi.fn());
const pulseFlushMock = vi.hoisted(() => vi.fn());
const pulseSetMock = vi.hoisted(() => vi.fn());
const getDeviceIdMock = vi.hoisted(() => vi.fn());
const getSessionIdMock = vi.hoisted(() => vi.fn());
const getLocaleInfoMock = vi.hoisted(() => vi.fn());

vi.mock('@pulse/server', () => ({ createClient: createClientMock }));
vi.mock('@pulse/core', () => ({ pulse: { flush: pulseFlushMock, set: pulseSetMock } }));
vi.mock('./auth.ts', () => ({ loadCredentials: loadCredentialsMock }));
vi.mock('./device-id.ts', () => ({ getDeviceId: getDeviceIdMock }));
vi.mock('#infra/utils/session-id.ts', () => ({ getSessionId: getSessionIdMock }));
vi.mock('#infra/utils/locale.ts', () => ({ getLocaleInfo: getLocaleInfoMock }));

import { createPulseClient, flushPulse, getInitialPulseState, runWithPulse } from './pulse.ts';

beforeEach(() => {
  createClientMock.mockReset().mockReturnValue({
    createAsyncContext: vi.fn(async (_state: unknown, fn: () => Promise<void>) => {
      await fn();
    }),
  });
  loadCredentialsMock.mockReset();
  pulseFlushMock.mockReset().mockResolvedValue(undefined);
  pulseSetMock.mockReset();
  getDeviceIdMock.mockReset().mockReturnValue('uuid-device-abc');
  getSessionIdMock.mockReset().mockReturnValue('uuid-session-xyz');
  getLocaleInfoMock.mockReset().mockReturnValue({
    countryCode: 'US',
    timezone: 'America/New_York',
    locale: 'en-US',
  });
  delete process.env.PULSE_OPT_OUT;
  delete process.env.PULSE_SERVER_URL;
});

afterEach(() => {
  delete process.env.PULSE_OPT_OUT;
  delete process.env.PULSE_SERVER_URL;
});

/* ── createPulseClient ───────────────────────────────────────── */

describe('createPulseClient', () => {
  it('passes app name + appVersion + resolved sdkVersion', () => {
    createPulseClient({ appVersion: '1.2.3' });
    expect(createClientMock).toHaveBeenCalledWith(
      expect.objectContaining({
        app: 'gen-ai',
        tracker: expect.objectContaining({
          appVersion: '1.2.3',
          // Resolved from @pulse/server/package.json at module load.
          sdkVersion: expect.stringMatching(/^\d+\.\d+\.\d+/),
        }),
      }),
    );
  });

  it('omits serverBaseURL when PULSE_SERVER_URL is not set', () => {
    createPulseClient({ appVersion: '1.0.0' });
    const cfg = createClientMock.mock.calls[0][0] as { tracker: Record<string, unknown> };
    expect(cfg.tracker).not.toHaveProperty('serverBaseURL');
  });

  it('passes serverBaseURL when PULSE_SERVER_URL is set', () => {
    process.env.PULSE_SERVER_URL = 'http://localhost:9999';
    createPulseClient({ appVersion: '1.0.0' });
    expect(createClientMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tracker: expect.objectContaining({ serverBaseURL: 'http://localhost:9999' }),
      }),
    );
  });
});

/* ── getInitialPulseState ────────────────────────────────────── */

describe('getInitialPulseState', () => {
  it('includes app_device_id, app_session_id, locale info, and user_id when logged in', () => {
    loadCredentialsMock.mockReturnValue({ uid: 'u-42', email: 'a@b' });
    expect(getInitialPulseState()).toEqual({
      app_device_id: 'uuid-device-abc',
      app_session_id: 'uuid-session-xyz',
      country_code: 'US',
      timezone: 'America/New_York',
      locale_code: 'en-US',
      user_id: 'u-42',
    });
  });

  it('omits user_id when not logged in but keeps every other field', () => {
    loadCredentialsMock.mockReturnValue(null);
    const state = getInitialPulseState();
    expect(state).toEqual({
      app_device_id: 'uuid-device-abc',
      app_session_id: 'uuid-session-xyz',
      country_code: 'US',
      timezone: 'America/New_York',
      locale_code: 'en-US',
    });
    expect(state.user_id).toBeUndefined();
  });

  it('omits app_device_id when device-id read fails (filesystem error)', () => {
    getDeviceIdMock.mockImplementation(() => {
      throw new Error('EACCES');
    });
    loadCredentialsMock.mockReturnValue(null);
    const state = getInitialPulseState();
    expect(state.app_device_id).toBeUndefined();
    // Everything else still populated.
    expect(state.app_session_id).toBe('uuid-session-xyz');
    expect(state.country_code).toBe('US');
  });

  it('omits locale fields when getLocaleInfo throws', () => {
    getLocaleInfoMock.mockImplementation(() => {
      throw new Error('Intl unavailable');
    });
    loadCredentialsMock.mockReturnValue(null);
    const state = getInitialPulseState();
    expect(state.country_code).toBeUndefined();
    expect(state.timezone).toBeUndefined();
    expect(state.locale_code).toBeUndefined();
    expect(state.app_device_id).toBe('uuid-device-abc');
  });

  it('still returns the rest of the state when loadCredentials throws', () => {
    loadCredentialsMock.mockImplementation(() => {
      throw new Error('credfile corrupt');
    });
    const state = getInitialPulseState();
    expect(state.user_id).toBeUndefined();
    expect(state.app_device_id).toBe('uuid-device-abc');
    expect(state.country_code).toBe('US');
  });
});

/* ── flushPulse ──────────────────────────────────────────────── */

describe('flushPulse', () => {
  it('resolves without calling flush when PULSE_OPT_OUT=1', async () => {
    process.env.PULSE_OPT_OUT = '1';
    await flushPulse();
    expect(pulseFlushMock).not.toHaveBeenCalled();
  });

  it('awaits pulse.flush() under normal conditions', async () => {
    await flushPulse();
    expect(pulseFlushMock).toHaveBeenCalledTimes(1);
  });

  it('does not throw when flush rejects', async () => {
    pulseFlushMock.mockRejectedValue(new Error('network gone'));
    await expect(flushPulse()).resolves.toBeUndefined();
  });

  it('times out when flush hangs longer than the cap', async () => {
    // Hanging flush — promise that never resolves.
    pulseFlushMock.mockImplementation(() => new Promise(() => undefined));
    const start = Date.now();
    await flushPulse(30); // 30ms cap
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(25);
    expect(elapsed).toBeLessThan(500); // wide margin for CI noise
  });
});

/* ── runWithPulse ────────────────────────────────────────────── */

describe('runWithPulse', () => {
  it('runs fn without setting up Pulse when PULSE_OPT_OUT=1', async () => {
    process.env.PULSE_OPT_OUT = '1';
    const fn = vi.fn(async () => undefined);
    await runWithPulse('1.0.0', fn);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(createClientMock).not.toHaveBeenCalled();
    expect(pulseFlushMock).not.toHaveBeenCalled();
  });

  it('applies the full initial state via pulse.set() inside the context', async () => {
    loadCredentialsMock.mockReturnValue({ uid: 'u-9' });
    const createAsyncContext = vi.fn(async (state: Record<string, unknown>, runner: () => Promise<void>) => {
      // Regression: custom snake_case keys passed as the createAsyncContext
      // init are silently dropped by PulseContext's STATE_KEYS whitelist, so
      // the init must stay empty and the state must go through pulse.set().
      expect(state).toEqual({});
      await runner();
    });
    createClientMock.mockReturnValue({ createAsyncContext });

    const fn = vi.fn(async () => undefined);
    await runWithPulse('1.0.0', fn);

    expect(createAsyncContext).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(pulseSetMock).toHaveBeenCalledTimes(1);
    expect(pulseSetMock).toHaveBeenCalledWith({
      user_id: 'u-9',
      app_device_id: 'uuid-device-abc',
      app_session_id: 'uuid-session-xyz',
      country_code: 'US',
      timezone: 'America/New_York',
      locale_code: 'en-US',
    });
  });

  it('calls pulse.set before running fn (state precedes any event)', async () => {
    const order: string[] = [];
    pulseSetMock.mockImplementation(() => order.push('set'));
    const fn = vi.fn(async () => {
      order.push('fn');
    });

    await runWithPulse('1.0.0', fn);

    expect(order).toEqual(['set', 'fn']);
  });

  it('flushes after success', async () => {
    await runWithPulse('1.0.0', async () => undefined);
    expect(pulseFlushMock).toHaveBeenCalledTimes(1);
  });

  it('flushes then re-throws on error', async () => {
    const err = new Error('boom');
    await expect(
      runWithPulse('1.0.0', async () => {
        throw err;
      }),
    ).rejects.toBe(err);
    expect(pulseFlushMock).toHaveBeenCalledTimes(1);
  });
});
