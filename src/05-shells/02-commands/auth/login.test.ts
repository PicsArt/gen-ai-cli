/**
 * Spec for the login command's flow selection.
 *   - `--device` routes to the device-code flow (deviceLogin)
 *   - no flag routes to the browser flow (login)
 */
import { describe, expect, it, vi } from 'vitest';

const deviceLoginMock = vi.fn();
const loginMock = vi.fn();
vi.mock('#services/device-auth.ts', () => ({ deviceLogin: (...a: unknown[]) => deviceLoginMock(...a) }));
vi.mock('#services/auth.ts', () => ({ login: (...a: unknown[]) => loginMock(...a) }));

import Login from './login.ts';

function makeCmd(device: boolean): Login {
  const cmd = Object.create(Login.prototype) as Login;
  const out = { info: vi.fn(), success: vi.fn() };
  Object.assign(cmd, {
    deps: { out },
    parse: async () => ({ flags: { device } }),
  });
  return cmd;
}

describe('login command flow selection', () => {
  it('calls deviceLogin when --device is set', async () => {
    deviceLoginMock.mockReset();
    loginMock.mockReset();
    deviceLoginMock.mockResolvedValue({ email: 'me@x.com' });
    await makeCmd(true).run();
    expect(deviceLoginMock).toHaveBeenCalledTimes(1);
    expect(loginMock).not.toHaveBeenCalled();
  });

  it('calls the browser login when --device is absent', async () => {
    deviceLoginMock.mockReset();
    loginMock.mockReset();
    loginMock.mockResolvedValue({ email: 'me@x.com' });
    await makeCmd(false).run();
    expect(loginMock).toHaveBeenCalledTimes(1);
    expect(deviceLoginMock).not.toHaveBeenCalled();
  });
});
