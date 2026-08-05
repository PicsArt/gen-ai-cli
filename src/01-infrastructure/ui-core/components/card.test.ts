import { describe, expect, it } from 'vitest';
import { createColorManager } from '../color.ts';
import { renderCard } from './card.ts';
import { visibleWidth } from './string-utils.ts';

const color = createColorManager({ enabled: false });

describe('renderCard — borders', () => {
  it('has rounded corners and contains the content', () => {
    const result = renderCard(['Hello world'], { color });
    const lines = result.split('\n').filter((l) => l.length > 0);
    expect(lines[0]).toContain('╭');
    expect(lines[lines.length - 1]).toContain('╰');
    expect(result).toContain('Hello world');
  });
});

describe('renderCard — title', () => {
  it('places the title in the top border line', () => {
    const result = renderCard(['Some content'], { color, title: 'My Title' });
    const topLine = result.split('\n')[0];
    expect(topLine).toContain('╭');
    expect(topLine).toContain('My Title');
  });
});

describe('renderCard — width', () => {
  it('respects an explicit fixed width', () => {
    const result = renderCard(['Short', 'A bit longer line'], { color, width: 40 });
    const lines = result.split('\n').filter((l) => l.length > 0);
    for (const line of lines) expect(visibleWidth(line)).toBe(40);
  });

  it('auto-sizes to the longest line', () => {
    const result = renderCard(['Short', 'A longer content line here'], { color });
    const lines = result.split('\n').filter((l) => l.length > 0);
    const widths = lines.map((l) => visibleWidth(l));
    const first = widths[0];
    for (const w of widths) expect(w).toBe(first);
    expect(first).toBeGreaterThanOrEqual(32);
  });

  it('respects maxWidth', () => {
    const longContent = 'A'.repeat(200);
    const result = renderCard([longContent], { color, maxWidth: 50 });
    const lines = result.split('\n').filter((l) => l.length > 0);
    for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(50);
  });
});

describe('renderCard — vertical padding', () => {
  it('adds empty padding lines above and below content', () => {
    const result = renderCard(['Content line'], { color });
    const lines = result.split('\n').filter((l) => l.length > 0);
    expect(lines.length).toBeGreaterThanOrEqual(5);
    expect(lines[1]).toContain('│');
    expect(lines[lines.length - 2]).toContain('│');
    expect(lines[1]).not.toContain('Content line');
    expect(lines[lines.length - 2]).not.toContain('Content line');
  });
});

describe('renderCard — plain mode', () => {
  it('drops box-drawing characters and indents content', () => {
    const result = renderCard(['Plain content', 'Second line'], { color, plain: true });
    expect(result).not.toContain('╭');
    expect(result).not.toContain('╰');
    expect(result).not.toContain('│');
    const contentLine = result.split('\n').find((l) => l.includes('Plain content'));
    expect(contentLine).toBeDefined();
    expect(contentLine?.startsWith('  ')).toBe(true);
  });
});
