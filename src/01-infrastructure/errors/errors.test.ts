/**
 * Typed CLI errors — exit codes + class hierarchy + per-class behavior.
 * Migrated from `__tests__/unit/errors.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import {
  ApiError,
  AuthError,
  CliError,
  ExitCode,
  FileError,
  InsufficientCreditsError,
  NetworkError,
  UsageError,
  ValidationError,
} from './index.ts';

describe('ExitCode', () => {
  it('has stable numeric codes for each category', () => {
    expect(ExitCode.OK).toBe(0);
    expect(ExitCode.GENERAL_ERROR).toBe(1);
    expect(ExitCode.USAGE_ERROR).toBe(2);
    expect(ExitCode.AUTH_ERROR).toBe(3);
    expect(ExitCode.NETWORK_ERROR).toBe(4);
    expect(ExitCode.API_ERROR).toBe(5);
    expect(ExitCode.VALIDATION_ERROR).toBe(6);
    expect(ExitCode.CREDITS_ERROR).toBe(7);
    expect(ExitCode.FILE_ERROR).toBe(8);
    expect(ExitCode.USER_CANCEL).toBe(9);
  });
});

describe('CliError hierarchy', () => {
  it('every concrete error extends CliError AND Error', () => {
    const errors = [
      new UsageError('bad flag'),
      new AuthError('not logged in'),
      new NetworkError('timeout'),
      new ApiError(429, 'rate limited'),
      new ValidationError([{ field: 'duration', message: 'must be 3-15' }]),
      new InsufficientCreditsError(5, 20),
      new FileError('missing.txt', 'not found'),
    ];
    for (const err of errors) {
      expect(err).toBeInstanceOf(CliError);
      expect(err).toBeInstanceOf(Error);
      expect(typeof err.exitCode).toBe('number');
      expect(err.friendlyMessage.length).toBeGreaterThan(0);
    }
  });
});

describe('per-class behavior', () => {
  it('UsageError → exit code 2, message preserved', () => {
    const err = new UsageError('--model requires a value');
    expect(err.exitCode).toBe(2);
    expect(err.friendlyMessage).toContain('--model requires a value');
  });

  it('AuthError → exit code 3 + login hint', () => {
    const err = new AuthError('token expired');
    expect(err.exitCode).toBe(3);
    expect(err.hint).toContain('gen-ai login');
  });

  it('NetworkError → exit code 4', () => {
    const err = new NetworkError('ECONNREFUSED');
    expect(err.exitCode).toBe(4);
    expect(err.friendlyMessage).toContain('server');
  });

  it('ApiError → exit code 5 + status code in message', () => {
    const err = new ApiError(429, 'Too Many Requests');
    expect(err.exitCode).toBe(5);
    expect(err.friendlyMessage).toContain('429');
  });

  it('ValidationError → exit code 6 + groups every field error', () => {
    const err = new ValidationError([
      { field: 'duration', message: 'must be 3-15' },
      { field: 'aspectRatio', message: 'invalid format' },
    ]);
    expect(err.exitCode).toBe(6);
    expect(err.friendlyMessage).toContain('duration');
    expect(err.friendlyMessage).toContain('aspectRatio');
  });

  it('InsufficientCreditsError → exit code 7 + balance & cost in message', () => {
    const err = new InsufficientCreditsError(5, 20);
    expect(err.exitCode).toBe(7);
    expect(err.friendlyMessage).toContain('5');
    expect(err.friendlyMessage).toContain('20');
  });

  it('FileError → exit code 8 + path in message', () => {
    const err = new FileError('/tmp/missing.txt', 'not found');
    expect(err.exitCode).toBe(8);
    expect(err.friendlyMessage).toContain('missing.txt');
  });
});
