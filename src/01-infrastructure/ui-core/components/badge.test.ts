import { describe, expect, it } from 'vitest';
import { createColorManager } from '../color.ts';
import { renderBadge, renderPresetBadge } from './badge.ts';

const color = createColorManager({ enabled: false });
const colorEnabled = createColorManager({ enabled: true });

describe('renderBadge', () => {
  it('renders the text inside the badge', () => {
    expect(renderBadge('image', { color })).toContain('image');
  });

  it('pads the text with spaces in color mode', () => {
    const result = renderBadge('video', { color: colorEnabled, bgColor: '#8B5CF6' });
    // eslint-disable-next-line no-control-regex
    const stripped = result.replace(/\x1b\[[0-9;]*m/g, '');
    expect(stripped).toContain(' video ');
  });

  it('renders plain mode as [text]', () => {
    expect(renderBadge('new', { color, plain: true })).toBe('[new]');
  });
});

describe('renderPresetBadge', () => {
  it('renders a badge for a known preset', () => {
    expect(renderPresetBadge('image', { color })).toContain('image');
  });

  it('falls back gracefully for unknown presets', () => {
    expect(renderPresetBadge('unknown-preset', { color })).toContain('unknown-preset');
  });
});
