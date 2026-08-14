/**
 * Startup banner — smoke tests for the boxed and compact variants.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { printBanner } from './banner.ts';

let originalColumnsDesc: PropertyDescriptor | undefined;

function setColumns(columns: number): void {
  Object.defineProperty(process.stdout, 'columns', { value: columns, configurable: true });
}

function captureStdout(fn: () => void): string {
  let output = '';
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    output += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  try {
    fn();
  } finally {
    process.stdout.write = orig;
  }
  return output;
}

beforeEach(() => {
  originalColumnsDesc = Object.getOwnPropertyDescriptor(process.stdout, 'columns');
});

afterEach(() => {
  if (originalColumnsDesc) Object.defineProperty(process.stdout, 'columns', originalColumnsDesc);
  else Reflect.deleteProperty(process.stdout, 'columns');
});

describe('printBanner', () => {
  it('prints nothing in quiet mode', () => {
    const output = captureStdout(() => printBanner('1.2.3', true));
    expect(output).toBe('');
  });

  it('prints the boxed ASCII banner with version and model counts on wide terminals', () => {
    setColumns(120);
    const output = captureStdout(() => printBanner('1.2.3'));
    expect(output).toContain('v1.2.3');
    expect(output).toMatch(/\d+ models/);
    expect(output).toMatch(/\d+ providers/);
    expect(output).toContain('┌');
    expect(output).toContain('└');
  });

  it('falls back to a compact banner on narrow terminals', () => {
    setColumns(50);
    const output = captureStdout(() => printBanner('1.2.3'));
    expect(output).toContain('v1.2.3');
    expect(output).not.toContain('┌');
  });
});
