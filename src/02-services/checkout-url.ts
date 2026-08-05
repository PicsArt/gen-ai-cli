/**
 * Picsart checkout-URL builder.
 *
 * Used when the CLI opens the browser to top up credits. Attaches the
 * analytics params the funnel reports expect (`page_origin`,
 * `action_button`) so the credits-wall path is attributable.
 *
 * Pure — no I/O. Lives in services so the analytics identity constants
 * (`CLI_CHECKOUT_ANALYTICS`) sit alongside other CLI-identity constants.
 */

const CHECKOUT_BASE = 'https://picsart.com/pricing';
const CHECKOUT_ANALYTICS_PARAMS = ['page_origin', 'action_button'] as const;

export type CheckoutAnalyticsKey = (typeof CHECKOUT_ANALYTICS_PARAMS)[number];
export type CheckoutAnalytics = Record<CheckoutAnalyticsKey, string>;

/** Analytics identity for any checkout link the CLI opens. */
export const CLI_CHECKOUT_ANALYTICS: CheckoutAnalytics = {
  page_origin: 'gen_ai_cli',
  action_button: 'gen_ai_cli_credits_wall',
};

export function buildCheckoutUrl(analytics: CheckoutAnalytics): string {
  const params = new URLSearchParams({ checkout: 'credit' });
  for (const key of CHECKOUT_ANALYTICS_PARAMS) {
    const value = analytics[key];
    if (value) params.set(key, value);
  }
  return `${CHECKOUT_BASE}?${params.toString()}`;
}
