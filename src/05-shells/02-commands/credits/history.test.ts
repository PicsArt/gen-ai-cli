import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockFetchHistory, mockGetAuthFetch } = vi.hoisted(() => ({
  mockFetchHistory: vi.fn(),
  mockGetAuthFetch: vi.fn(),
}));
vi.mock('#services/client.ts', () => ({ getAuthenticatedFetch: mockGetAuthFetch }));
vi.mock('#services/credits-history.ts', async (importActual) => ({
  ...(await importActual<typeof import('#services/credits-history.ts')>()),
  fetchCreditHistory: mockFetchHistory,
}));

import type { ColorManager } from '#infra/ui-core/color.ts';
import { CREDIT_HISTORY_MAX_PAGES, type CreditHistoryItem } from '#services/credits-history.ts';
import CreditsHistory, { describeCreditSource, formatCreditAmount, formatCreditDate } from './history.ts';

const color = {
  red: (s: string) => `R(${s})`,
  green: (s: string) => `G(${s})`,
} as unknown as ColorManager;

const base: CreditHistoryItem = { type: 'deduct', creditAmount: 3, date: '2026-11-10T07:43:16.911Z' };

describe('formatCreditAmount', () => {
  it('shows spending as a red negative', () => {
    expect(formatCreditAmount(base, color)).toBe('R(-3)');
  });

  it('shows refunds and grants as a green positive', () => {
    expect(formatCreditAmount({ ...base, type: 'refund' }, color)).toBe('G(+3)');
    expect(formatCreditAmount({ ...base, type: 'grant', creditAmount: 500 }, color)).toBe('G(+500)');
  });
});

describe('describeCreditSource', () => {
  it('prefers the product name', () => {
    expect(describeCreditSource({ ...base, name: 'AI Playground' })).toBe('AI Playground');
  });

  it('labels known grant types', () => {
    expect(describeCreditSource({ ...base, type: 'grant', grantType: 'SUBSCRIPTION' })).toBe('Subscription');
    expect(describeCreditSource({ ...base, type: 'grant', grantType: 'OTP' })).toBe('One-time purchase');
  });

  it('is empty when nothing identifies the source', () => {
    expect(describeCreditSource(base)).toBe('');
  });
});

describe('formatCreditDate', () => {
  it('formats as local YYYY-MM-DD HH:MM', () => {
    // Build the fixture in local time so the expectation holds in every TZ.
    expect(formatCreditDate(new Date(2026, 10, 10, 7, 43, 16, 911).toISOString())).toBe('2026-11-10 07:43');
  });

  it('passes through unparseable input', () => {
    expect(formatCreditDate('not-a-date')).toBe('not-a-date');
  });
});

describe('CreditsHistory.run', () => {
  const spend: CreditHistoryItem = { type: 'deduct', creditAmount: 4, name: 'AI SDK CLI', date: base.date };
  const grant: CreditHistoryItem = { type: 'grant', grantType: 'SUBSCRIPTION', creditAmount: 500, date: base.date };
  const authFetch = vi.fn();

  beforeEach(() => {
    mockFetchHistory.mockReset();
    mockGetAuthFetch.mockReset().mockResolvedValue({ authenticatedFetch: authFetch });
  });

  function makeInstance(flags: { n?: number; all?: boolean; type?: string[] }, json = false) {
    const out = { json: vi.fn(), info: vi.fn(), richTable: vi.fn() };
    const instance = Object.create(CreditsHistory.prototype);
    Object.assign(instance, {
      deps: {
        color: { ...color, bold: (s: string) => s, dim: (s: string) => s },
        out,
        flags: { json, quiet: true, debug: false, plain: false, noInput: true },
      },
      parse: async () => ({ flags: { n: 20, all: false, ...flags } }),
    });
    return { instance, out };
  }

  it('passes -n and --type through to the service', async () => {
    mockFetchHistory.mockResolvedValue({ items: [], hasMore: false, capped: false });
    const { instance } = makeInstance({ n: 50, type: ['deduct', 'refund'] });
    await CreditsHistory.prototype.run.call(instance);
    expect(mockFetchHistory).toHaveBeenCalledWith(
      authFetch,
      expect.any(String),
      expect.objectContaining({ limit: 50, types: ['deduct', 'refund'] }),
    );
  });

  it('--all removes the limit', async () => {
    mockFetchHistory.mockResolvedValue({ items: [], hasMore: false, capped: false });
    const { instance } = makeInstance({ all: true, n: 20 });
    await CreditsHistory.prototype.run.call(instance);
    expect(mockFetchHistory.mock.calls[0][2].limit).toBeUndefined();
  });

  it('--json prints items, flags and summary only', async () => {
    mockFetchHistory.mockResolvedValue({ items: [spend, grant], hasMore: true, capped: false });
    const { instance, out } = makeInstance({}, true);
    await CreditsHistory.prototype.run.call(instance);
    expect(out.json).toHaveBeenCalledWith({
      items: [spend, grant],
      hasMore: true,
      capped: false,
      summary: { spent: 4, refunded: 0, granted: 500, net: 4 },
    });
    expect(out.richTable).not.toHaveBeenCalled();
  });

  it('renders a table, totals, and the older-history hint', async () => {
    mockFetchHistory.mockResolvedValue({ items: [spend, grant], hasMore: true, capped: false });
    const { instance, out } = makeInstance({});
    await CreditsHistory.prototype.run.call(instance);
    const rows = out.richTable.mock.calls[0][0];
    expect(rows.map((r: Record<string, string>) => [r.type, r.credits, r.source])).toEqual([
      ['deduct', 'R(-4)', 'AI SDK CLI'],
      ['grant', 'G(+500)', 'Subscription'],
    ]);
    const info = out.info.mock.calls.map((c) => c[0]).join('\n');
    expect(info).toContain('Spent 4');
    expect(info).toContain('granted 500');
    expect(info).toContain('Older history available');
  });

  it('says when the request cap stopped the walk', async () => {
    mockFetchHistory.mockResolvedValue({ items: [spend], hasMore: true, capped: true });
    const { instance, out } = makeInstance({ all: true });
    await CreditsHistory.prototype.run.call(instance);
    const info = out.info.mock.calls.map((c) => c[0]).join('\n');
    expect(info).toContain(`Stopped after ${CREDIT_HISTORY_MAX_PAGES} requests`);
    expect(info).not.toContain('Older history available');
  });

  it('keeps the cap warning when a filtered walk finds nothing (regression)', async () => {
    mockFetchHistory.mockResolvedValue({ items: [], hasMore: true, capped: true });
    const { instance, out } = makeInstance({ all: true, type: ['refund'] });
    await CreditsHistory.prototype.run.call(instance);
    const info = out.info.mock.calls.map((c) => c[0]).join('\n');
    expect(info).toContain('No refund transactions found.');
    expect(info).not.toContain('No credit history yet.');
    expect(info).toContain(`Stopped after ${CREDIT_HISTORY_MAX_PAGES} requests`);
    expect(out.richTable).not.toHaveBeenCalled();
  });

  it('prints an empty state instead of an empty table', async () => {
    mockFetchHistory.mockResolvedValue({ items: [], hasMore: false, capped: false });
    const { instance, out } = makeInstance({});
    await CreditsHistory.prototype.run.call(instance);
    expect(out.richTable).not.toHaveBeenCalled();
    expect(out.info).toHaveBeenCalledWith('No credit history yet.');
  });
});
