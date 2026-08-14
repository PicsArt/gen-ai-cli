# LLM-Wiki for the gen-ai CLI repo — Design (Sub-project A)

**Status:** Approved (design), pending implementation plan
**Date:** 2026-08-07
**Author:** Sargis Harutyunyan + Claude
**Source pattern:** [Karpathy — "LLM Wiki"](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)

## 1. Background & motivation

Karpathy's "LLM Wiki" pattern proposes that instead of re-deriving knowledge from
raw documents on every query (RAG), an LLM agent **incrementally builds and
maintains a persistent, interlinked markdown wiki** that sits between the human
and the raw sources. Knowledge is compiled once and kept current, so it
*compounds* rather than being rebuilt each time. The three layers are **raw
sources → wiki → schema**, navigated by an `index.md` (content catalog) and a
`log.md` (chronological, append-only record). Core operations are **ingest**,
**query**, and **lint**.

This spec instantiates that pattern **for this repository's own knowledge**: a
committed, team-shared knowledge base covering (1) the codebase architecture,
(2) product knowledge (models, operations, flags, SDK behavior), and (3)
roadmaps. Because the skeleton is kept domain-agnostic, it also serves as a
reusable scaffold.

### Scope decomposition (context)

The original request ("integrate the whole pattern — codebase KB, product
feature, scaffold, roadmaps, product knowledge") was decomposed into:

- **Sub-project A (THIS spec):** instantiate the LLM-wiki *for this repo*.
  Delivers the codebase KB, product knowledge, roadmaps, and — by staying
  generic — the reusable scaffold. Markdown + conventions only; no product code.
- **Sub-project B (later, separate spec):** ship the wiki as a CLI product
  feature (`gen-ai wiki ingest|query|lint`) wired into the 5-layer architecture.
  Deferred; it automates the conventions A defines, so it is easier to design
  after A exists.

## 2. Goals / non-goals

**Goals**
- A committed `knowledge/` directory implementing the raw → wiki → schema layers.
- A maintainer **schema** (`knowledge/CLAUDE.md`) that turns any agent working in
  `knowledge/` into a disciplined wiki maintainer with explicit ingest/query/lint
  playbooks.
- `index.md` (content catalog) and `log.md` (append-only chronological record)
  with a grep-able entry convention.
- A handful of **real seed pages** proving the pattern end-to-end.
- **Non-destructive:** nothing outside `knowledge/` is moved or rewritten (at
  most one optional pointer line added to the root).

**Non-goals**
- No CLI commands / product code (that is Sub-project B).
- No embedding-based search engine (index.md is sufficient at this scale;
  `qmd`/MCP noted as the future upgrade path).
- No migration of existing `docs/`, `ARCHITECTURE.md`, or `.claude/rules/` —
  they are referenced as raw sources, not copied.

## 3. Architecture

### 3.1 The three layers (adapted)

- **Raw sources.** Immutable inputs the wiki is derived from. Two kinds:
  - *In-repo referenced sources* — the codebase itself plus the already-committed
    `ARCHITECTURE.md`, `CLI_ARCHITECTURE_VISUAL.html`, `docs/`, and
    `.claude/rules/`. These are **referenced by path, never copied**.
  - *External dropped sources* — articles, SDK docs, meeting notes, images
    dropped into `knowledge/raw/`. Immutable once added.
- **The wiki** (`knowledge/wiki/`). LLM-owned markdown: overview/synthesis,
  entity pages, concept pages, source summaries, roadmap pages. The agent
  creates/updates these and maintains cross-references. Humans read; the LLM
  writes.
- **The schema** (`knowledge/CLAUDE.md`). Governs how the wiki is structured and
  the workflows for ingest/query/lint. Auto-loads when an agent operates inside
  `knowledge/`, so the maintainer discipline is always in context there.

### 3.2 Directory layout

```
knowledge/
  CLAUDE.md            # SCHEMA: wiki-maintainer rules + operation playbooks
  index.md             # content catalog, grouped by domain + page-type
  log.md               # append-only: ## [YYYY-MM-DD] ingest|query|lint | Title
  raw/
    README.md          # what goes here + immutability rule
    .gitkeep
    assets/            # downloaded images for external sources
      .gitkeep
  wiki/
    overview.md        # top-level synthesis / entry point
    entities/          # a model, a service, a vendor, a command
    concepts/          # e.g. "the 5 layers", "param surface"
    sources/           # one summary page per ingested external source
    roadmap/           # living roadmap pages seeded from CLAUDE.md tech-debt
```

### 3.3 Page format (convention enforced by the schema)

Every wiki page is markdown with YAML frontmatter:

```yaml
---
title: The 5-layer architecture
domain: codebase          # codebase | product | roadmap
created: 2026-08-07
updated: 2026-08-07
tags: [architecture, layers]
sources: [ARCHITECTURE.md, .claude/rules/commands-layer.md]
status: active            # active | stale | superseded
---
```

Body ends with a `## Related` section of `[[wiki-links]]` for backlinks. The
`domain:` tag (not folders) is what lets `index.md` group pages by domain while
the directory tree stays flat and generic.

## 4. Operations (playbooks defined in the schema)

- **Ingest.** Read the source → discuss key takeaways with the human → write a
  `sources/<slug>.md` summary → update the relevant `entities/` and `concepts/`
  pages (noting contradictions with prior claims) → update `index.md` → append an
  entry to `log.md`. A single source may touch 10–15 pages.
- **Query.** Read `index.md` first → drill into relevant pages → synthesize an
  answer **with citations** → offer to file valuable answers back into the wiki
  as new pages so explorations compound.
- **Lint.** Health-check: contradictions between pages, stale/superseded claims,
  orphan pages (no inbound links), important concepts lacking a page, missing
  cross-references, and data gaps fillable via web search. Suggest new questions
  and sources.

## 5. Navigation & logging

- **`index.md`** — content-oriented catalog. Every page listed with a link, a
  one-line summary, and grouped by `domain` then page-type. Updated on every
  ingest. Read first on every query. Sufficient at this scale (~hundreds of
  pages); no embedding RAG needed.
- **`log.md`** — chronological, append-only. Each entry begins with the grep-able
  prefix `## [YYYY-MM-DD] <op> | <title>` so `grep "^## \[" log.md | tail -5`
  yields recent activity. Dates are real calendar dates supplied at write time.
- **Future upgrade path** (documented, not built): when the wiki outgrows the
  index, add [`qmd`](https://github.com/tobi/qmd) (local hybrid BM25/vector
  search with CLI + MCP) or a simple search script.

## 6. Seed content (to prove the pattern)

- `knowledge/CLAUDE.md` — the full maintainer schema.
- `knowledge/index.md` — populated catalog referencing the seed pages.
- `knowledge/log.md` — one initial `ingest` entry recording the bootstrap.
- `knowledge/raw/README.md` — raw-source rules.
- `wiki/overview.md` — synthesis entry point linking the domains.
- `wiki/concepts/five-layer-architecture.md` — seeded from `ARCHITECTURE.md`.
- `wiki/entities/<one model-or-service stub>` — one concrete example page.
- `wiki/roadmap/*.md` — living pages seeded from the CLAUDE.md tech-debt list
  (e.g. re-enable cognitive-complexity rule; `--input-dir` static flag group;
  `extend.ts` decision; snapshot drift; public-npm smoke CI job).

## 7. Non-destructive guarantee & git

- All new files live under `knowledge/`. No file outside it is moved or rewritten.
- Optional single addition: a one-line pointer to `knowledge/` from the repo
  root README or root docs index (only if it exists and the user wants it).
- `knowledge/` is **committed** (team/product knowledge, versioned, PR-reviewable).

## 8. Success criteria

1. `knowledge/` exists with the layout in §3.2; nothing outside it changed.
2. `knowledge/CLAUDE.md` fully specifies page format + ingest/query/lint playbooks.
3. `index.md` and `log.md` follow the conventions in §5 and reference the seed pages.
4. At least the seed pages in §6 exist, valid frontmatter, with working
   `[[links]]`/`## Related` backlinks and citations to their raw sources.
5. A fresh agent, given only `knowledge/CLAUDE.md`, can correctly perform an
   ingest and a query following the playbooks.
6. The skeleton is domain-agnostic enough to copy into another project as a
   scaffold.

## 9. Open questions / deferred

- Exact choice of the first seeded `entities/` example (a specific model vs a
  service like `client.ts`) — decide at implementation time.
- Whether to add the optional root pointer line (§7) — confirm with user.
- Sub-project B (CLI feature) — separate spec after A lands.
