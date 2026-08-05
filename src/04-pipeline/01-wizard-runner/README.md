# Wizard Runner (placeholder — not yet built)

The block that consumes `WizardStep[]` (from `03-definitions/02-flows/03-compose/02-wizard-flow/`) and actually prompts the user.

## Responsibility

Take a declarative step list and produce an `answers` object the wizard-reader can consume.

## Public API (planned)

```ts
runWizard(
  steps: readonly WizardStep[],
  deps: { /* prompt lib, output stream, signal */ },
): Promise<Record<string, unknown>>
```

## What this block does NOT do

- Generate the step list (that's `wizard-schema` / `wizard-flow` composer in `03-definitions/02-flows/`).
- Convert answers into ctx (that's `wizard-reader` in `03-definitions/01-param-surface/04-interpret/`).
- Resolve files for upload (that's the file-upload block, future sibling under `04-pipeline/`).

## Why it's here and not in `03-definitions/`

This block does I/O — writes prompts, reads keystrokes. `03-definitions/` is pure data and pure functions. The runner is a runtime stage, so it belongs in the pipeline tier.

## Status

Empty folder. Implementation comes after the cleanup pass finishes and we start extracting blocks from the legacy `02-resolve/interactive/`.
