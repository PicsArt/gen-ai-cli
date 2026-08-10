# Knowledge base — wiki maintainer schema

You are the maintainer of this LLM-wiki: a persistent, compounding markdown
knowledge base for the `@picsart/gen-ai` CLI. You write and maintain every page
here; the human curates sources, directs analysis, and asks questions.

Pattern: [Karpathy — LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f).

## Layers

- **Raw sources** (`raw/` + referenced repo files) — immutable. Never edit. See `raw/README.md`.
- **The wiki** (`wiki/`) — you own it entirely. Pages below.
- **This schema** (`CLAUDE.md`) — the rules. Co-evolve it with the human.

## Page format (MANDATORY on every `wiki/**/*.md`)

```yaml
---
title: Human-readable title
domain: codebase        # codebase | product | roadmap
created: 2026-08-07     # YYYY-MM-DD, set once
updated: 2026-08-07     # YYYY-MM-DD, bump on every edit
tags: [architecture, layers]
sources: [ARCHITECTURE.md, .claude/rules/commands-layer.md]  # repo paths or raw/ files
status: active          # active | stale | superseded
---
```

- Body is prose/tables. Cite sources inline by path.
- End every page with a `## Related` section of `[[page-name]]` backlinks.
- Page types → folders: `wiki/entities/` (a model, service, command, vendor),
  `wiki/concepts/` (an idea like "the 5 layers"), `wiki/sources/` (one summary
  per external raw source), `wiki/roadmap/` (living roadmap/tech-debt),
  `wiki/overview.md` (the synthesis entry point).
- New page vs. edit: add a new page when a distinct entity/concept/source has no
  page yet; otherwise edit the existing page and bump `updated`.

## Navigation

- **`index.md`** — the catalog. Read it FIRST on any query. Every page appears
  with a link + one-line summary, grouped by domain then page-type. Update it on
  every ingest.
- **`log.md`** — append-only. Every entry starts `## [YYYY-MM-DD] <op> | <title>`
  (`<op>` = ingest | query | lint) so `grep "^## \[" log.md | tail -5` works.
  Never rewrite history; append.

## Operations

### Ingest
1. Read the source (a `raw/` file or a referenced repo path).
2. Discuss key takeaways with the human.
3. Write/refresh `wiki/sources/<slug>.md` summarizing it.
4. Update the relevant `entities/` and `concepts/` pages; note contradictions
   with prior claims (mark superseded claims `status: superseded`).
5. Update `index.md`. Append a `## [date] ingest | <title>` entry to `log.md`.
6. Run `bash scripts/lint-wiki.sh` and fix anything it flags.

### Query
1. Read `index.md`, drill into the relevant pages.
2. Synthesize an answer WITH citations (page + source paths).
3. Offer to file a valuable answer back as a new `wiki/` page so it compounds.
4. If filed, update `index.md` and append `## [date] query | <question>` to `log.md`.

### Lint
Run `bash scripts/lint-wiki.sh` for mechanical checks, then review for:
contradictions between pages, stale/superseded claims, orphan pages (no inbound
`[[links]]`), important concepts lacking a page, missing cross-references, and
data gaps fillable via web search. Append `## [date] lint | <scope>` to `log.md`.

## Scale / future

`index.md` is enough at this scale (~hundreds of pages). When it outgrows the
index, add [`qmd`](https://github.com/tobi/qmd) (local hybrid BM25/vector search,
CLI + MCP) or a small search script. Do not add search infra before then.
