/**
 * Handle InsufficientCreditsError — offer to open billing page.
 */

import { InsufficientCreditsError } from '#infra/errors/credits.ts';
import { openInDefault } from '#infra/utils/open.ts';
import { selectWithNav } from '#pipeline/01-wizard-runner/nav.ts';
import { BACK, CANCEL } from '#pipeline/01-wizard-runner/wizard-state.ts';
import type { CliDeps } from '#root/deps.ts';
import { buildCheckoutUrl, CLI_CHECKOUT_ANALYTICS } from '#services/checkout-url.ts';

export function isCreditsError(err: unknown): boolean {
  if (err instanceof InsufficientCreditsError) return true;
  if (err instanceof Error && /402|not enough.*credit|insufficient.*credit/i.test(err.message)) return true;
  return false;
}

export async function handleCreditsError(err: unknown, deps: CliDeps): Promise<boolean> {
  const msg = err instanceof Error ? err.message : 'not enough credits';
  deps.out.error(`Insufficient credits: ${msg}`);

  if (deps.flags.noInput) return true;

  const action = await selectWithNav<'buy' | 'exit'>({
    message: 'What would you like to do?',
    choices: [
      { name: 'Open browser to add credits', value: 'buy' },
      { name: 'Exit', value: 'exit' },
    ],
    cancelOnly: true,
  });

  if (action === BACK || action === CANCEL || action === 'exit') return true;

  if (action === 'buy') {
    openInDefault(buildCheckoutUrl(CLI_CHECKOUT_ANALYTICS));
    deps.out.info('Opening checkout in browser...');
  }
  return true;
}
