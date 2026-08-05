# Block 1 — Aliases

A static table of flag-name overrides. Read once by Block 3 (Catalog) when it turns SDK descriptor keys into CLI flag names.

## What it does

The default mapping from an SDK key to a CLI flag is a deterministic camelCase → kebab-case conversion:

- `aspectRatio` → `--aspect-ratio`
- `negativePrompt` → `--negative-prompt`

This table holds the exceptions. Three kinds of override are supported:

| Field | Effect | Example |
|---|---|---|
| `char` | Adds a single-character short alias. The default long form still works. | `prompt: { char: 'p' }` → both `--prompt` and `-p` work |
| `flag` | Replaces the default long form. The default name is gone. | `imageUrls: { flag: 'image' }` → CLI ships `--image`, not `--image-urls` |
| `aliases` | Adds extra long-form names. The default long form still works. | `aspectRatio: { aliases: ['ar'] }` → both `--aspect-ratio` and `--ar` work |

A single entry can combine the three fields:

```ts
imageUrls: { flag: 'image', char: 'i' }
// User can type: --image foo.png   OR   -i foo.png
```

## When to add an entry

One of these has to be true:

1. The flag is invoked in nearly every generation call and earns a single-letter short alias (`-p`, `-m`, `-i`, `-d`, `-n`, `-r`, `-a`).
2. The historic CLI shipped under a different long-form name and renaming would break user scripts (`--voice` for `voiceId`, `--image` for `imageUrls`, `--video` for `videoUrl`, `--audio` for `audioUrl`).
3. The full kebab name is awkward and a shorter alternative is more natural (`--ar` for `--aspect-ratio`, `--neg` for `--negative-prompt`, `--cfg` for `--cfg-scale`).

Aliases that don't satisfy at least one of these stay out of the table. The single-letter namespace is finite — every short char added is one fewer for future flags.

## When NOT to add an entry

- The default kebab name is already short and self-describing.
- The proposed alias shadows a subcommand name (`enhance`, `edit`, `upload`, etc.) — confusing UX.
- The proposed char or long alias collides with an existing one — `aliases.test.ts` rejects this automatically.

## What it does NOT do

- Validate that the SDK key actually exists. That's Block 3's job — it loads the real catalog and asserts every alias key maps to a real descriptor.
- Generate flag definitions. That's Block 5 (Flag Generator).
- Parse user input. That's Block 6 (Value Collector).

This block is pure data. No logic, no SDK imports, no side effects.

## Public API

```ts
export interface FlagAlias {
  flag?: string;
  char?: string;
  aliases?: readonly string[];
}

export type AliasMap = Readonly<Record<string, FlagAlias>>;

export const ALIAS_MAP: AliasMap;
```

## Tests (aliases.test.ts)

Verifies internal consistency:

- Keys are camelCase.
- Each entry declares at least one override field.
- `char` is exactly one lowercase letter.
- `flag` overrides and `aliases` entries are kebab-case.
- No two keys claim the same `char`, `flag`, or long alias.
- Snapshot test locks the full map — every change requires an intentional snapshot update.

The "every alias key maps to a real SDK descriptor" assertion lives in Block 3 (Catalog), where the SDK fixture is available.

## File layout

```
01-aliases/
├── README.md          ← this file
├── aliases.ts         ← the table + types
├── aliases.test.ts    ← consistency checks + snapshot
└── __snapshots__/
    └── aliases.test.ts.snap
```
