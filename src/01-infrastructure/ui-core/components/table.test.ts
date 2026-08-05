import { describe, expect, it } from 'vitest';
import { createColorManager } from '../color.ts';
import { renderTable } from './table.ts';

const color = createColorManager({ enabled: false });

const sampleColumns = [
  { key: 'model', label: 'Model' },
  { key: 'provider', label: 'Provider' },
  { key: 'mode', label: 'Mode' },
  { key: 'credits', label: 'Credits', align: 'right' as const },
];

const sampleRows = [
  { model: 'Flux 2 Pro', provider: 'Flux', mode: 'image', credits: '8' },
  { model: 'Kling 3.0 Pro', provider: 'Kling', mode: 'video', credits: '40' },
];

describe('renderTable', () => {
  it('renders headers and rows', () => {
    const result = renderTable(sampleRows, { columns: sampleColumns, color });
    expect(result).toContain('╭');
    expect(result).toContain('Model');
    expect(result).toContain('Provider');
    expect(result).toContain('Flux 2 Pro');
    expect(result).toContain('Kling 3.0 Pro');
  });

  it('wraps the table in card borders', () => {
    const result = renderTable(sampleRows, { columns: sampleColumns, color });
    expect(result).toContain('╭');
    expect(result).toContain('╰');
    expect(result).toContain('│');
  });

  it('emits a header separator line', () => {
    expect(renderTable(sampleRows, { columns: sampleColumns, color })).toContain('──');
  });

  it('plain mode drops borders but keeps headers + rows', () => {
    const result = renderTable(sampleRows, { columns: sampleColumns, color, plain: true });
    expect(result).not.toContain('╭');
    expect(result).not.toContain('╰');
    expect(result).not.toContain('│');
    expect(result).toContain('Model');
    expect(result).toContain('Flux 2 Pro');
  });

  it('handles missing keys gracefully', () => {
    const columns = [
      { key: 'name', label: 'Name' },
      { key: 'value', label: 'Value' },
      { key: 'extra', label: 'Extra' },
    ];
    const rows = [{ name: 'Alpha', value: '100' }, { name: 'Beta' }] as Record<string, string>[];
    const result = renderTable(rows, { columns, color });
    expect(result).toContain('Alpha');
    expect(result).toContain('100');
    expect(result).toContain('Beta');
  });
});
