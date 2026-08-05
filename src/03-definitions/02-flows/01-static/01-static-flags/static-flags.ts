/**
 * Static Flags — hand-maintained groups of oclif Flag definitions that
 * have no SDK descriptor source.
 *
 * Think of this as the flow-side counterpart to `aliases.ts` in
 * Param Surface: just data. The Flows composer picks groups by name
 * (e.g. `staticFlagGroups: ['universal', 'output']` on a FlowSpec) and
 * spreads them into the final FlagSet alongside the descriptor-derived
 * flags from `flag-schema`.
 *
 * Adding a flag:
 *   1. Pick the right group below (or add a new one).
 *   2. Declare the oclif Flag with a clear description.
 *   3. Reference it from the relevant FlowSpec(s) by adding the group
 *      name to `staticFlagGroups`.
 *
 * Each flag's key here is the CLI-visible flag name (kebab-case for
 * multi-word). When the composer merges these with descriptor flags,
 * a name collision would surface immediately — keep names distinct
 * from any SDK descriptor key.
 */
import { Flags } from '@oclif/core';

/** A group of oclif Flag definitions, spreadable into `static flags = {...}`. */
export type StaticFlagSet = Record<string, unknown>;

/* ─────────────────────────────────────────────────────────────────────── */
/*  Group: universal                                                      */
/*  Applies to every command — controls IO format, verbosity, color.      */
/* ─────────────────────────────────────────────────────────────────────── */

const universal: StaticFlagSet = {
  json: Flags.boolean({ description: 'Output as JSON', default: false }),
  plain: Flags.boolean({ description: 'Plain output (for piping)', default: false }),
  quiet: Flags.boolean({ char: 'q', description: 'Suppress non-essential output', default: false }),
  'no-color': Flags.boolean({ description: 'Disable color output', default: false }),
  'no-input': Flags.boolean({
    description: 'Disable interactive prompts (fail if input needed)',
    aliases: ['silent'],
    char: 's',
    default: false,
  }),
  debug: Flags.boolean({ char: 'D', description: 'Show debug output', default: false }),
  'poll-timeout': Flags.string({
    description:
      'Polling timeout for async jobs (e.g. "30m", "1h", "90s", or bare minutes "45"). Defaults: 30m for video/audio, 10m otherwise.',
  }),
  'max-cost': Flags.integer({
    description: 'Abort before submitting if the estimated cost exceeds this many credits',
  }),
};

/* ─────────────────────────────────────────────────────────────────────── */
/*  Group: output                                                         */
/*  Where and how results are delivered.                                  */
/* ─────────────────────────────────────────────────────────────────────── */

const output: StaticFlagSet = {
  download: Flags.string({
    description: 'Download result to directory (default: ./output)',
    aliases: ['out'],
    // No char: lowercase `-d` collides with descriptor --duration. Use `--out` short alias.
  }),
  'save-to-drive': Flags.boolean({
    description: 'Save result to Picsart Drive',
    default: true,
    allowNo: true,
    aliases: ['drive'],
  }),
  'drive-folder': Flags.string({
    description: 'Drive subfolder name (creates if needed)',
    default: 'gen-ai-cli',
    aliases: ['folder'],
  }),
  open: Flags.boolean({ char: 'o', description: 'Open result in default app after completion', allowNo: true }),
  clipboard: Flags.boolean({ char: 'c', description: 'Copy result URL to clipboard', default: false }),
  bell: Flags.boolean({ description: 'Play terminal bell on completion', default: false }),
  notify: Flags.boolean({ description: 'Send desktop notification on completion', default: false }),
};

/* ─────────────────────────────────────────────────────────────────────── */
/*  Group: model                                                          */
/*  Model selection — required for any flow that runs a generation.       */
/* ─────────────────────────────────────────────────────────────────────── */

const model: StaticFlagSet = {
  model: Flags.string({ char: 'm', description: 'Model ID or name' }),
};

/* ─────────────────────────────────────────────────────────────────────── */
/*  Group: prompt-input                                                   */
/*  Alternative sources for the `--prompt` value. Applies to any flow     */
/*  whose chosen model can accept a prompt (the SDK descriptor surface    */
/*  decides whether `--prompt` itself is present).                        */
/*                                                                        */
/*  The resolver dispatcher reads `--prompt-file` (and piped stdin) and   */
/*  writes the result into `flags.prompt` before resolution begins.       */
/* ─────────────────────────────────────────────────────────────────────── */

const promptInput: StaticFlagSet = {
  'prompt-file': Flags.string({
    description: 'Read the prompt from a file (overrides any piped stdin; loses to an explicit --prompt)',
  }),
};

/* ─────────────────────────────────────────────────────────────────────── */
/*  Group: directory-input                                                */
/*  `--input-dir ./photos` expands a folder of files into either one      */
/*  multi-file generation (`--multi`) or a batch — one job per file —     */
/*  (`--batch`). The runner expands `--input-dir` BEFORE the normal       */
/*  pipeline runs, dispatching either back to the same operation with    */
/*  expanded file flags, or to `batch:run` with a generated manifest.    */
/* ─────────────────────────────────────────────────────────────────────── */

const directoryInput: StaticFlagSet = {
  'input-dir': Flags.string({
    description: 'Run the operation on every file in a directory',
  }),
  multi: Flags.boolean({
    description: 'Treat the directory as ONE generation with multiple file inputs (max 14)',
    default: false,
  }),
  batch: Flags.boolean({
    description: 'Treat the directory as ONE generation per file (batch mode)',
    default: false,
  }),
  type: Flags.string({
    description: 'Filter directory files by media type',
    options: ['image', 'video', 'audio'],
  }),
  'max-files': Flags.integer({
    description: 'Maximum number of files to pull from --input-dir',
    default: 30,
  }),
  concurrency: Flags.integer({
    description: 'Parallel batch jobs (--batch mode only)',
    default: 3,
  }),
};

/* ─────────────────────────────────────────────────────────────────────── */
/*  Registry                                                              */
/* ─────────────────────────────────────────────────────────────────────── */

export const STATIC_FLAG_GROUPS = {
  universal,
  output,
  model,
  'prompt-input': promptInput,
  'directory-input': directoryInput,
} as const;

export type StaticFlagGroupName = keyof typeof STATIC_FLAG_GROUPS;

/**
 * Look up a named group. Returns the group's FlagSet for spreading
 * into the composed flag set. Type-narrow on the name parameter, so
 * unknown group names are a compile-time error.
 */
export function getStaticFlagGroup(name: StaticFlagGroupName): StaticFlagSet {
  return STATIC_FLAG_GROUPS[name];
}
