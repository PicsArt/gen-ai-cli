/**
 * FlowSpec — one declarative entry per CLI command.
 *
 * Type-only sub-part. The actual flow declarations live in
 * `02-registry/02-flows/<name>.ts` and each export a value of this
 * type. The composer (`03-compose/`) reads a FlowSpec plus the
 * Param Surface catalog and produces a command's final flag set and
 * wizard step list.
 *
 * A FlowSpec is pure data — no functions that close over runtime
 * state, no I/O, no class instances. Just metadata + a model
 * predicate.
 *
 * Adding a new CLI command = adding a new file under
 * `02-registry/02-flows/` that exports a FlowSpec. The composer and
 * the oclif command shell do the rest.
 */
import type { ModelDefinition } from '@picsart/ai-sdk';
import type { StaticFlagGroupName } from '../../01-static/01-static-flags/index.ts';
import type { StaticStepGroupName } from '../../01-static/02-static-steps/index.ts';

/**
 * User-supplied inputs a flow requires before it can run.
 * Drives both the wizard's pre-steps and the resolver's input pipeline.
 */
export type RequiredInput = 'prompt' | 'image' | 'video' | 'audio';

export interface FlowSpec {
  /**
   * Unique identifier. Also the CLI command name as the user types it
   * (`gen-ai <id>`). Lowercase kebab-case (e.g. 'generate', 'remove-bg').
   */
  readonly id: string;

  /** Short description for `gen-ai --help` and `gen-ai <id> --help`. */
  readonly description: string;

  /**
   * Picks which models this flow can run on. The composer applies this
   * to `Models.list()` to derive the allowed-id set for `filterCatalog`.
   *
   * Receives the full `ModelDefinition` from the SDK so the predicate
   * can read `inputType`, `disabled`, `toolId`, `features`, `provider`,
   * etc. Keep the predicate pure — no I/O, no side effects, no closures
   * over mutable state.
   */
  readonly modelFilter: (model: ModelDefinition) => boolean;

  /**
   * Static flag groups to spread into the command's flag set. Looked
   * up by name in `01-static/01-static-flags/STATIC_FLAG_GROUPS`.
   *
   * Empty array = no static flags added (only descriptor-derived ones
   * from Param Surface). Most flows include at least 'universal' and
   * 'model'.
   */
  readonly staticFlagGroups: readonly StaticFlagGroupName[];

  /**
   * Static wizard step groups to splice into the wizard flow. Looked
   * up by name in `01-static/02-static-steps/STATIC_STEP_GROUPS`.
   *
   * Empty array = no static steps added (only descriptor-derived ones
   * from Param Surface). The composer decides where each group goes
   * relative to the descriptor steps.
   */
  readonly staticStepGroups: readonly StaticStepGroupName[];

  /**
   * Inputs the user must supply before the flow can run. The resolver
   * enforces this for scripted mode; the wizard runner prompts for it
   * up front in interactive mode.
   */
  readonly requiredInputs: readonly RequiredInput[];

  /**
   * Optional default model used when the user doesn't pass `-m`. The
   * id must satisfy `modelFilter`; the composer doesn't verify this
   * at module load (would force a Models.list() call), so flow authors
   * are responsible for keeping it in sync.
   */
  readonly defaultModel?: string;

  /**
   * Text/LLM flows only. When true, the resolver's text finalize step requires
   * an image OR a video and defaults the prompt to a describe instruction (the
   * `describe` media-analysis flow). General LLM flows like `ask` leave this
   * off — they accept a text-only prompt with optional media.
   */
  readonly requiresMedia?: boolean;

  /**
   * Optional example invocations shown by `gen-ai <id> --help`.
   *
   * Each entry is either:
   *   - a plain command-line string (description omitted), or
   *   - `{ command, description }` for an annotated example.
   *
   * Mirrors oclif's `Command.examples` shape so the builder can pass
   * the list straight through without conversion.
   */
  readonly examples?: readonly FlowExample[];
}

/** Single example shown by `gen-ai <id> --help`. */
export type FlowExample = string | { command: string; description: string };

/**
 * Identity helper that gives `as const`-style narrowing while keeping
 * the value typed as a plain `FlowSpec`. Flow declaration files can
 * write `export default defineFlow({ ... })` and get IDE/type-error
 * feedback at the call site, not at the importer.
 *
 * Pure pass-through at runtime.
 */
export function defineFlow(spec: FlowSpec): FlowSpec {
  return spec;
}
