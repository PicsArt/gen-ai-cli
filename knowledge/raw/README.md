# Raw sources

Immutable inputs the wiki is derived from. **The LLM reads from here but never
edits these files.**

Two kinds of raw source:

1. **Referenced in-repo sources** (NOT stored here): the codebase itself, plus
   `ARCHITECTURE.md`, `CLI_ARCHITECTURE_VISUAL.html`, `docs/`, and
   `.claude/rules/`. Wiki pages cite these by their repo-relative path.
2. **External dropped sources** (stored here): articles, SDK docs, meeting
   notes, transcripts, images. Drop a file in, then ask the agent to *ingest*
   it (see `../CLAUDE.md`).

Images go in `assets/`. Once a source is added, treat it as append-only —
supersede rather than rewrite.
