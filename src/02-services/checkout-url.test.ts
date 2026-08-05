/**
 * Spec for services/checkout-url.
 *
 * Contract:
 *   buildCheckoutUrl(analytics):
 *     - Base URL: https://picsart.com/pricing
 *     - Always includes `checkout=credit`
 *     - Appends each declared analytics key when its value is truthy
 *     - Omits keys with empty-string values (still partially attributed)
 *     - URL-encodes values via URLSearchParams (no manual encoding)
 *
 *   CLI_CHECKOUT_ANALYTICS:
 *     - page_origin: 'gen_ai_cli'
 *     - action_button: 'gen_ai_cli_credits_wall'
 */
import { describe, expect, it } from 'vitest';
import { buildCheckoutUrl, CLI_CHECKOUT_ANALYTICS } from './checkout-url.ts';

describe('buildCheckoutUrl', () => {
  it('produces the expected URL for the CLI defaults', () => {
    expect(buildCheckoutUrl(CLI_CHECKOUT_ANALYTICS)).toBe(
      'https://picsart.com/pricing?checkout=credit&page_origin=gen_ai_cli&action_button=gen_ai_cli_credits_wall',
    );
  });

  it('always includes checkout=credit', () => {
    const url = buildCheckoutUrl({ page_origin: 'x', action_button: 'y' });
    expect(new URL(url).searchParams.get('checkout')).toBe('credit');
  });

  it('omits an empty analytics value but keeps the others', () => {
    const url = buildCheckoutUrl({ page_origin: '', action_button: 'btn' });
    const params = new URL(url).searchParams;
    expect(params.has('page_origin')).toBe(false);
    expect(params.get('action_button')).toBe('btn');
  });

  it('URL-encodes values that contain spaces or special characters', () => {
    const url = buildCheckoutUrl({ page_origin: 'cli credits wall', action_button: 'a&b' });
    const params = new URL(url).searchParams;
    expect(params.get('page_origin')).toBe('cli credits wall');
    expect(params.get('action_button')).toBe('a&b');
  });
});

describe('CLI_CHECKOUT_ANALYTICS', () => {
  it('uses the agreed values', () => {
    expect(CLI_CHECKOUT_ANALYTICS.page_origin).toBe('gen_ai_cli');
    expect(CLI_CHECKOUT_ANALYTICS.action_button).toBe('gen_ai_cli_credits_wall');
  });
});
