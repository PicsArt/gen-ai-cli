/**
 * Wizard runner — orchestrates multi-step interactive flows
 * with Back/Cancel/Skip navigation via sentinel values.
 */

export const BACK = Symbol('BACK');
export const CANCEL = Symbol('CANCEL');
export const SKIP = Symbol('SKIP');

export type StepResult<T> = T | typeof BACK | typeof CANCEL | typeof SKIP;
/** Narrower result for nav prompts — they never return SKIP. */
export type NavResult<T> = T | typeof BACK | typeof CANCEL;

export interface WizardStep<T = unknown> {
  id: string;
  run: () => Promise<StepResult<T>>;
}

export async function runWizard(steps: WizardStep[]): Promise<Record<string, unknown> | null> {
  const results: Record<string, unknown> = {};
  const visitedStack: number[] = [];
  let stepIndex = 0;

  while (stepIndex < steps.length) {
    const step = steps[stepIndex];

    // Clean slate: discard any previous result for this step
    delete results[step.id];

    const value = await step.run();

    if (value === CANCEL) {
      return null;
    }

    if (value === BACK) {
      if (visitedStack.length === 0) {
        return null; // Back at first executed step = cancel
      }
      stepIndex = visitedStack.pop()!;
      continue;
    }

    if (value === SKIP) {
      stepIndex++;
      continue;
    }

    results[step.id] = value;
    visitedStack.push(stepIndex);
    stepIndex++;
  }

  return results;
}
