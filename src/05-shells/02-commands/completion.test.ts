/**
 * Spec for shell-completion generation.
 *
 * The point of this suite is the drift guard: completions are derived from the
 * command registry, so a newly added command appears automatically. The old bug
 * was a hand-maintained command list that silently omitted new commands
 * (e.g. `describe`).
 */
import { describe, expect, it } from 'vitest';
import { COMMANDS as MANIFEST } from '#root/commands-manifest.ts';
import {
  generateBashCompletion,
  generateFishCompletion,
  generateZshCompletion,
  topLevelCommands,
} from './completion.ts';

describe('topLevelCommands', () => {
  it('collapses colon subcommands, filters hidden, dedupes, and sorts', () => {
    const result = topLevelCommands([
      { id: 'generate' },
      { id: 'models' },
      { id: 'models:info' },
      { id: 'config:get' },
      { id: 'config:set' },
      { id: 'secret', hidden: true },
    ]);
    expect(result).toEqual(['config', 'generate', 'models']);
  });
});

describe('completion stays in sync with the command manifest', () => {
  const expected = [...new Set(Object.keys(MANIFEST).map((key) => key.split(':')[0]))].sort();

  it('reproduces every manifest top-level command from the registry', () => {
    const fromManifest = topLevelCommands(Object.keys(MANIFEST).map((id) => ({ id })));
    expect(fromManifest).toEqual(expected);
  });

  it('renders every command into each shell script (incl. describe)', () => {
    for (const render of [generateBashCompletion, generateZshCompletion, generateFishCompletion]) {
      const script = render([], expected);
      for (const command of expected) {
        expect(script).toContain(command);
      }
    }
    // Regression: describe was missing from the old hardcoded list.
    expect(expected).toContain('describe');
  });
});
