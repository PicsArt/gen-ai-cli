/**
 * Credit spending history (`GET /credits/history`).
 *
 * The endpoint merges grants and deductions server-side, so a page can come
 * back shorter than `limit` while more history remains. The only end-of-history
 * signal is a missing `metadata.nextPage` (or an empty page). `nextPage` is a
 * ready-to-follow path relative to the API host, e.g.
 * `/credits/history?page=<opaque-encoded-cursor>`.
 */
import type { AuthenticatedFetch } from '@picsart/ai-sdk';
import { ApiError } from '#infra/errors/api.ts';

export type GrantType = 'INITIAL_FREE_CREDITS' | 'SUBSCRIPTION' | 'OTP' | 'MANUAL';

export type CreditHistoryItemType = 'grant' | 'deduct' | 'refund';

export interface CreditHistoryItem {
  type: CreditHistoryItemType;
  grantType?: GrantType;
  creditAmount: number;
  /** Product that spent / refunded the credits (e.g. "AI SDK CLI", "AI Playground"). */
  name?: string;
  date: string;
}

interface CreditHistoryResponse {
  status?: string;
  message?: string;
  reason?: string;
  response?: CreditHistoryItem[];
  metadata?: { nextPage?: string };
}

export interface CreditHistoryPage {
  items: CreditHistoryItem[];
  nextPage?: string;
}

/**
 * Upper bound per request. Each request costs ~0.7s regardless of size, so
 * bigger pages make `--all` faster (658 rows: 7.6s at 100, 2.6s at 250).
 * The API may return slightly more than `limit`; callers trim.
 */
export const CREDIT_HISTORY_PAGE_SIZE = 250;

/** Hard stop for `--all`: 40 requests ≈ 10,000 transactions, ~30s worst case. */
export const CREDIT_HISTORY_MAX_PAGES = 40;

export async function fetchCreditHistoryPage(
  fetchFn: AuthenticatedFetch,
  apiUrl: string,
  opts: { nextPage?: string; limit?: number } = {},
): Promise<CreditHistoryPage> {
  const url = opts.nextPage
    ? new URL(opts.nextPage, apiUrl)
    : new URL(`${apiUrl}/credits/history?limit=${opts.limit ?? CREDIT_HISTORY_PAGE_SIZE}`);

  const res = await fetchFn(url.toString());
  if (!res.ok) {
    let reason = res.statusText || 'Request failed';
    try {
      const body = (await res.json()) as CreditHistoryResponse;
      reason = body.message ?? body.reason ?? reason;
    } catch {
      // Non-JSON error body — keep the status text.
    }
    throw new ApiError(res.status, `Failed to fetch credit history: ${reason}`);
  }

  const body = (await res.json()) as CreditHistoryResponse;
  return { items: body.response ?? [], nextPage: body.metadata?.nextPage || undefined };
}

export interface CreditHistoryResult {
  items: CreditHistoryItem[];
  /** True when older history exists beyond what was returned. */
  hasMore: boolean;
  /** True when the page cap stopped the walk (only reachable with `--all` or a huge `-n`). */
  capped: boolean;
}

/**
 * Collect history newest-first until `limit` matching items are gathered
 * (`limit: undefined` = everything, bounded by `maxPages`).
 *
 * Loop guards — the cursor is server-controlled, so never trust it to end:
 *   - empty page → stop
 *   - same cursor twice → stop
 *   - `maxPages` requests → stop, `capped: true`
 * Rows are never compared: transactions have no id, and two real charges can
 * share every field, so "already seen" can't be told apart from a replay.
 */
export async function fetchCreditHistory(
  fetchFn: AuthenticatedFetch,
  apiUrl: string,
  opts: {
    limit?: number;
    types?: readonly CreditHistoryItemType[];
    maxPages?: number;
    onPage?: (fetched: number, pages: number) => void;
  } = {},
): Promise<CreditHistoryResult> {
  const { limit, types, maxPages = CREDIT_HISTORY_MAX_PAGES, onPage } = opts;
  const items: CreditHistoryItem[] = [];
  const seenCursors = new Set<string>();
  let nextPage: string | undefined;
  let pages = 0;
  let fetched = 0;

  do {
    const remaining = limit === undefined ? CREDIT_HISTORY_PAGE_SIZE : limit - items.length;
    // Filtering is client-side, so over-fetch to avoid many tiny round-trips.
    const pageSize = types ? CREDIT_HISTORY_PAGE_SIZE : Math.min(remaining, CREDIT_HISTORY_PAGE_SIZE);
    const page = await fetchCreditHistoryPage(fetchFn, apiUrl, { nextPage, limit: pageSize });
    pages++;

    fetched += page.items.length;
    items.push(...(types ? page.items.filter((i) => types.includes(i.type)) : page.items));
    onPage?.(fetched, pages);

    nextPage = page.nextPage;
    if (page.items.length === 0 || (nextPage && seenCursors.has(nextPage))) nextPage = undefined;
    if (nextPage) seenCursors.add(nextPage);
  } while (nextPage && pages < maxPages && (limit === undefined || items.length < limit));

  const capped = nextPage !== undefined && pages >= maxPages;
  if (limit !== undefined && items.length > limit) {
    // Over-fetched (filtering, or the API overshot `limit`): the trimmed tail is still unseen history.
    return { items: items.slice(0, limit), hasMore: true, capped };
  }
  return { items, hasMore: nextPage !== undefined, capped };
}

export interface CreditHistorySummary {
  spent: number;
  refunded: number;
  granted: number;
  /** spent − refunded */
  net: number;
}

export function summarizeCreditHistory(items: readonly CreditHistoryItem[]): CreditHistorySummary {
  let spent = 0;
  let refunded = 0;
  let granted = 0;
  for (const item of items) {
    if (item.type === 'deduct') spent += item.creditAmount;
    else if (item.type === 'refund') refunded += item.creditAmount;
    else if (item.type === 'grant') granted += item.creditAmount;
  }
  return { spent, refunded, granted, net: spent - refunded };
}
