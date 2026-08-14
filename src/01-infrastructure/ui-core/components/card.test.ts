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

describe('renderCard — edge cases', () => {
  it('truncates a title longer than the card so the top border never overflows', () => {
    const result = renderCard(['x'], { color, title: 'A very long title that exceeds the card width', width: 20 });
    const lines = result.split('\n').filter((l) => l.length > 0);
    const widths = lines.map((l) => visibleWidth(l));
    for (const w of widths) expect(w).toBe(20);
  });

  it('survives a tiny width without throwing or emitting negative padding', () => {
    for (const width of [1, 2, 4, 6]) {
      const result = renderCard(['some content'], { color, width });
      expect(result.length).toBeGreaterThan(0);
    }
  });

  it('truncates content lines that exceed the available width', () => {
    const result = renderCard(['B'.repeat(300)], { color, maxWidth: 40 });
    const lines = result.split('\n').filter((l) => l.length > 0);
    for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(40);
    expect(result).toContain('…');
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
