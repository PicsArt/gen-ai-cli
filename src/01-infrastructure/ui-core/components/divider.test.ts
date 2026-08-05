import { describe, expect, it } from 'vitest';
import { createColorManager } from '../color.ts';
import { renderDivider } from './divider.ts';
import { visibleWidth } from './string-utils.ts';

const color = createColorManager({ enabled: false });

describe('renderDivider', () => {
  it('emits the requested width using thin line characters', () => {
    const result = renderDivider({ color, width: 40 });
    expect(result.length).toBe(40);
    expect(result).toContain('─');
  });

  it('embeds the label within the line and preserves total width', () => {
    const label = 'Quick Start';
    const width = 40;
    const result = renderDivider({ color, label, width });
    expect(result).toContain(label);
    expect(result).toContain('─');
    expect(visibleWidth(result)).toBe(width);
  });

  it('plain mode uses - instead of ─', () => {
    const result = renderDivider({ color, label: 'Parameters', width: 40, plain: true });
    expect(result).toContain('Parameters');
    expect(result).toContain('-');
    expect(result).not.toContain('─');
  });
});
