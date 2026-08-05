# Static Flags

The flow-side counterpart to Param Surface's `aliases.ts`: pure data. Hand-maintained groups of oclif `Flag` definitions that the SDK never declares — verbosity (`--quiet`, `--debug`), output destination (`--download`, `--save-to-drive`), model picker (`-m`), and friends.

Every FlowSpec references these by **group name**. The composer spreads the named groups into the final FlagSet alongside the descriptor-derived flags from Param Surface's `flag-schema`.

## Why hand-maintained

These flags have no SDK descriptor source. They're behaviors the *CLI* invents — how to print results, where to save them, which model to pick. The SDK doesn't (and shouldn't) know about them. Keeping them here makes them visible, diffable, and trivial to add to.

## Current groups

| Group | Purpose | Flags |
|---|---|---|
| `universal` | Verbosity / format / color / interactivity — applies to every command | `--json`, `--plain`, `-q, --quiet`, `--no-color`, `--no-input`, `-D, --debug` |
| `output` | Where / how results are delivered | `--download` (alias `--out`), `--save-to-drive` (alias `--drive`), `--drive-folder` (alias `--folder`), `-o, --open`, `-c, --clipboard`, `--bell`, `--notify` |
| `model` | Model selection — required for any flow that runs a generation | `-m, --model` |

### Char choices, briefly

- **`-q` (quiet), `-m` (model), `-o` (open), `-c` (clipboard)** — lowercase, no collision with any descriptor `char` in `ALIAS_MAP` (`p`, `m`, `n`, `d`, `r`, `i`, `a`). `model` is a CLI-only orphan in the alias map for this exact reason.
- **`-D` (debug, uppercase)** — lowercase `-d` is taken by the descriptor `duration`. Uppercase keeps debug short without collision.
- **`--download` has no `char`** — would have wanted `-d`, but same collision as above. Use `--out` as the short long-alias.

A cross-block collision test in `static-flags.test.ts` asserts no static name / char / alias overlaps with any descriptor-derived flag emitted by Param Surface. Adding a colliding alias will fail that test immediately.

## Adding a flag

1. Pick the right group (or add a new one).
2. Declare the oclif `Flag` with a clear description.
3. If you added a new group, also add it to the `STATIC_FLAG_GROUPS` const and the `StaticFlagGroupName` type widens automatically.
4. Reference the group from any FlowSpec that needs it via `staticFlagGroups: ['universal', 'output', ...]`.

## Naming rules

- **Multi-word flags** are kebab-case (`save-to-drive`, `drive-folder`).
- **No collisions across groups.** A test asserts each flag name appears in at most one group — composers spread multiple groups together, so a duplicate would silently overwrite.
- **Don't shadow descriptor keys.** If the SDK declares `aspectRatio`, don't add a static `aspect-ratio` flag here — Param Surface's `flag-schema` already produces it. Static flags are for *behaviors the SDK doesn't know about*.

## Public API

```ts
import { STATIC_FLAG_GROUPS, getStaticFlagGroup, type StaticFlagGroupName } from './static-flags.ts';

STATIC_FLAG_GROUPS.universal   // raw access
getStaticFlagGroup('output')   // typed lookup — unknown names are a compile error
```

## What it does NOT do

- **Compose flags into a command.** That's `03-compose/flag-set/`. This sub-part is data only.
- **Validate values.** Each Flag carries its own oclif validation rules. The reader (flag-reader in Param Surface) doesn't touch these — the command itself reads them.
- **Have anything to do with descriptors.** Static = "the CLI invented this", not "derived from the SDK".

## File layout

```
01-static-flags/
├── README.md             ← this file
├── static-flags.ts       ← STATIC_FLAG_GROUPS + getStaticFlagGroup
└── static-flags.test.ts  ← group shape + per-group keys + no-collisions + lookup
```
