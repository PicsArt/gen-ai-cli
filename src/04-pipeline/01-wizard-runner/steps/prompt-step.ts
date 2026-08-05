/**
 * Wizard step: text prompt input.
 *
 * If --prompt flag was provided, returns it directly.
 * Otherwise shows the rich command box and handles $EDITOR fallback.
 *
 * Returns:
 *   string — the prompt text
 *   'BACK' — user pressed ESC (go back)
 *   'CANCEL' — user pressed Ctrl+C (cancel wizard)
 */
import type { ModelDefinition } from '@picsart/ai-sdk';
import { promptWithCommandBox } from '#infra/ui/prompt-box.ts';
import { openEditorForPrompt } from '#pipeline/01-wizard-runner/prompts/prompt-params.ts';
import { BACK, type CANCEL } from '#pipeline/01-wizard-runner/wizard-state.ts';
import type { CliDeps } from '#root/deps.ts';

export type PromptStepResult = string | typeof BACK | typeof CANCEL;

export async function runPromptStep(
  deps: CliDeps,
  model: ModelDefinition,
  promptFlag?: string,
): Promise<PromptStepResult> {
  // If --prompt flag was given, use it directly
  if (promptFlag?.trim()) {
    return promptFlag.trim();
  }

  // Show the rich command box prompt
  // promptWithCommandBox returns null for both ESC and Ctrl+C
  // We treat null as BACK (go to previous step)
  // Ctrl+C is handled by the SIGINT listener in the REPL
  const result = await promptWithCommandBox({
    modelId: model.id,
    modelName: model.name,
  });

  if (result === null) return BACK;

  // Handle $EDITOR escape sequence
  if (result === '\x00editor') {
    const editorResult = openEditorForPrompt();
    if (!editorResult?.trim()) {
      deps.out.warn('Editor produced no content');
      return BACK;
    }
    return editorResult.trim();
  }

  return result.trim() || BACK;
}
