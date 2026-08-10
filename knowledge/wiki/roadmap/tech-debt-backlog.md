---
title: Tech-debt backlog
domain: roadmap
created: 2026-08-07
updated: 2026-08-07
tags: [roadmap, tech-debt]
sources: [.claude/CLAUDE.md]
status: active
---

Living backlog seeded from the `.claude/CLAUDE.md` "Tech-debt follow-ups"
section. Update status as items land.

1. **Re-enable `noExcessiveCognitiveComplexity`** in `biome.json` (currently
   `"off"`). Most offenders were oclif `run()` bodies now collapsed by the
   operation-command factory — remeasure and flip back to `"error"`.
2. **Wire `--input-dir` as a static flag group** on every operation (Design A:
   explicit `--multi`/`--batch`). Logic exists in
   `04-pipeline/02-resolve/input-dir.ts`; needs the flag group + a builder
   pre-flight hook.
3. **Decide `extend.ts`** — keep as a `02-commands/meta/` chain-wrapper, or fold
   N-iteration support into the factory.
4. **Snapshot drift** in `01-param-surface/02-catalog` +
   `03-describe/01-flag-schema` — SDK added `elementList`/`multiPrompt`/
   `thinkingLevel` descriptors; accept with `vitest -u` after eyeballing the diff.
5. **Add a public-npm smoke job to CI** — `npm pack dist/`, install the tarball
   in an isolated public-registry-only temp dir, run `gen-ai models`. Guards the
   self-contained-bundle invariant.

## Related
- [[overview]]
