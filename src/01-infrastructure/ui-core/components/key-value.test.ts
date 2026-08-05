import { describe, expect, it } from 'vitest';
import { createColorManager } from '../color.ts';
import { renderKeyValue } from './key-value.ts';

const color = createColorManager({ enabled: false });

describe('renderKeyValue', () => {
  const pairs: [string, string][] = [
    ['Model', 'Flux 2 Pro'],
    ['Provider', 'Flux'],
    ['Cost', '8 credits'],
  ];

  it('renders every key and value', () => {
    const result = renderKeyValue(pairs, { color });
    expect(result).toContain('Model');
    expect(result).toContain('Flux 2 Pro');
    expect(result).toContain('Provider');
    expect(result).toContain('Flux');
    expect(result).toContain('Cost');
    expect(result).toContain('8 credits');
  });

  it('aligns values to the longest key', () => {
    const result = renderKeyValue(pairs, { color });
    const lines = result.split('\n');
    // longest key "Provider" = 8 chars; indent=2, gap=4 → value starts at col 14
    const expectedValueStart = 2 + 8 + 4;
    for (const line of lines) {
      const value = pairs.find(([, v]) => line.includes(v))?.[1];
      if (value) expect(line.indexOf(value)).toBe(expectedValueStart);
    }
  });

  it('respects indent option', () => {
    const flat: [string, string][] = [['Key', 'Value']];
    expect(renderKeyValue(flat, { color, indent: 4 }).startsWith('    ')).toBe(true);
    const tight = renderKeyValue(flat, { color, indent: 0 });
    expect(tight.startsWith(' ')).toBe(false);
    expect(tight.startsWith('Key')).toBe(true);
  });

  it('returns empty string for empty pairs', () => {
    expect(renderKeyValue([], { color })).toBe('');
  });
});
