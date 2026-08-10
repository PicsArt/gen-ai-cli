# Log

Append-only. Each entry: `## [YYYY-MM-DD] <op> | <title>` (op = ingest | query | lint).

## [2026-08-07] ingest | Bootstrap knowledge base

Instantiated the LLM-wiki: schema (`CLAUDE.md`), validator
(`scripts/lint-wiki.sh`), raw-source rules, and seed pages — overview, the
5-layer architecture concept, the `getAiClient()` entity, and the tech-debt
roadmap. Sources: `ARCHITECTURE.md`, `.claude/CLAUDE.md`, `.claude/rules/`,
`src/02-services/client.ts`.
