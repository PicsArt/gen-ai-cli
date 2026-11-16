/**
 * Spec for services/credits-history.
 *
 * Contract:
 *   fetchCreditHistoryPage: first page → `/credits/history?limit=N`; later pages
 *     follow `metadata.nextPage` verbatim (relative to the API host); non-2xx → ApiError.
 *   fetchCreditHistory: walks pages until `limit` rows, never trusts the cursor to end
 *     (empty page / repeated cursor / replayed rows / maxPages all stop it).
 *   summarizeCreditHistory: totals per type, net = spent − refunded.
 */
import type { AuthenticatedFetch } from '@picsart/ai-sdk';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '#infra/errors/api.ts';
import {
  type CreditHistoryItem,
  fetchCreditHistory,
  fetchCreditHistoryPage,
  summarizeCreditHistory,
} from './credits-history.ts';

const API = 'https://api.example.com';

function item(n: number, type: CreditHistoryItem['type'] = 'deduct'): CreditHistoryItem {
  return {
    type,
    creditAmount: n,
    name: 'AI SDK CLI',
    date: `2026-11-${String(30 - (n % 30)).padStart(2, '0')}T00:00:${String(n % 60).padStart(2, '0')}.000Z`,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** Fake fetch serving `pages` in order; page i's cursor is `/credits/history?page=c{i+1}`. */
function pagedFetch(pages: CreditHistoryItem[][], cursor = (i: number) => `/credits/history?page=c${i + 1}`) {
  let i = 0;
  const fn = vi.fn(async (_url: string) => {
    const idx = i++;
    const items = pages[idx] ?? [];
    const hasNext = idx < pages.length - 1;
    return json({ status: 'success', response: items, metadata: hasNext ? { nextPage: cursor(idx) } : {} });
  });
  return fn as unknown as AuthenticatedFetch & typeof fn;
}

describe('fetchCreditHistoryPage', () => {
  it('requests the first page with a limit', async () => {
    const f = pagedFetch([[item(1)]]);
    await fetchCreditHistoryPage(f, API, { limit: 20 });
    expect(f.mock.calls[0][0]).toBe(`${API}/credits/history?limit=20`);
  });

  it('follows nextPage verbatim without re-encoding', async () => {
    const f = pagedFetch([[item(1)]]);
    const cursor = '/credits/history?page=include_invalidated_grants%3Dfalse%26deduction_offset%3D3';
    await fetchCreditHistoryPage(f, API, { nextPage: cursor });
    expect(f.mock.calls[0][0]).toBe(`${API}${cursor}`);
  });

  it('throws ApiError with the server message on non-2xx', async () => {
    const f = vi.fn(async () =>
      json({ status: 'error', message: 'Unauthorized' }, 401),
    ) as unknown as AuthenticatedFetch;
    const err = await fetchCreditHistoryPage(f, API).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).statusCode).toBe(401);
    expect((err as ApiError).message).toContain('Unauthorized');
  });
});

describe('fetchCreditHistory', () => {
  it('walks pages until the limit and reports hasMore', async () => {
    const f = pagedFetch([[item(1), item(2)], [item(3), item(4)], [item(5)]]);
    const res = await fetchCreditHistory(f, API, { limit: 3 });
    expect(res.items.map((i) => i.creditAmount)).toEqual([1, 2, 3]);
    expect(res.hasMore).toBe(true);
    expect(res.capped).toBe(false);
  });

  it('keeps going past short pages and stops only when nextPage is gone', async () => {
    const f = pagedFetch([[item(1)], [item(2)], [item(3)]]);
    const res = await fetchCreditHistory(f, API);
    expect(res.items).toHaveLength(3);
    expect(res.hasMore).toBe(false);
    expect(f).toHaveBeenCalledTimes(3);
  });

  it('trims when the API returns more than asked', async () => {
    const f = pagedFetch([[item(1), item(2), item(3)], [item(4)]]);
    const res = await fetchCreditHistory(f, API, { limit: 2 });
    expect(res.items).toHaveLength(2);
    expect(res.hasMore).toBe(true);
  });

  it('filters by type and keeps fetching until enough matches', async () => {
    const f = pagedFetch([[item(1), item(2, 'refund')], [item(3)], [item(4, 'refund'), item(5, 'refund')]]);
    const res = await fetchCreditHistory(f, API, { limit: 2, types: ['refund'] });
    expect(res.items.map((i) => i.creditAmount)).toEqual([2, 4]);
    expect(res.hasMore).toBe(true);
  });

  it('keeps identical rows within a page (two real identical charges)', async () => {
    const f = pagedFetch([[item(1), item(1)]]);
    const res = await fetchCreditHistory(f, API);
    expect(res.items).toHaveLength(2);
  });

  it('keeps identical charges on successive pages and keeps walking (regression)', async () => {
    // [charge], [identicalCharge], [olderCharge] — rows have no id, so a field
    // match must not be mistaken for a replay that ends the walk.
    const f = pagedFetch([[item(1)], [item(1)], [item(2)]]);
    const res = await fetchCreditHistory(f, API);
    expect(res.items.map((i) => i.creditAmount)).toEqual([1, 1, 2]);
    expect(res.hasMore).toBe(false);
    expect(f).toHaveBeenCalledTimes(3);
  });

  describe('loop guards', () => {
    it('stops on an empty page even if a cursor is returned', async () => {
      const f = vi.fn(async () => json({ response: [], metadata: { nextPage: '/credits/history?page=x' } }));
      const res = await fetchCreditHistory(f as unknown as AuthenticatedFetch, API);
      expect(f).toHaveBeenCalledTimes(1);
      expect(res.hasMore).toBe(false);
    });

    it('stops when the same cursor comes back twice', async () => {
      let n = 0;
      const f = vi.fn(async () =>
        json({ response: [item(++n)], metadata: { nextPage: '/credits/history?page=same' } }),
      );
      const res = await fetchCreditHistory(f as unknown as AuthenticatedFetch, API);
      expect(f).toHaveBeenCalledTimes(2);
      expect(res.items).toHaveLength(2);
      expect(res.hasMore).toBe(false);
    });

    it('bounds a cursor that changes while the rows repeat via the page cap', async () => {
      let n = 0;
      const f = vi.fn(async () =>
        json({ response: [item(1), item(2)], metadata: { nextPage: `/credits/history?page=${++n}` } }),
      );
      const res = await fetchCreditHistory(f as unknown as AuthenticatedFetch, API, { maxPages: 3 });
      expect(f).toHaveBeenCalledTimes(3);
      expect(res.capped).toBe(true);
    });

    it('stops at maxPages and reports capped', async () => {
      let n = 0;
      const f = vi.fn(async () =>
        json({ response: [item(++n)], metadata: { nextPage: `/credits/history?page=${n}` } }),
      );
      const res = await fetchCreditHistory(f as unknown as AuthenticatedFetch, API, { maxPages: 5 });
      expect(f).toHaveBeenCalledTimes(5);
      expect(res.capped).toBe(true);
      expect(res.hasMore).toBe(true);
    });
  });

  it('reports progress per page', async () => {
    const onPage = vi.fn();
    await fetchCreditHistory(pagedFetch([[item(1), item(2)], [item(3)]]), API, { onPage });
    expect(onPage.mock.calls).toEqual([
      [2, 1],
      [3, 2],
    ]);
  });
});

describe('summarizeCreditHistory', () => {
  it('totals each type and nets refunds against spend', () => {
    const s = summarizeCreditHistory([item(5), item(3), item(2, 'refund'), { ...item(500, 'grant'), name: undefined }]);
    expect(s).toEqual({ spent: 8, refunded: 2, granted: 500, net: 6 });
  });
});
