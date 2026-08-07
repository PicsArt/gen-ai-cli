---
paths:
  - "src/resolvers/**/*.ts"
---

# Resolvers layer rules

Collects inputs — does not execute or produce output.

- Cannot import from `execution/` or `output/`
- Can import from `shared/ui/` (needs prompts for interactive mode)
- Both interactive and scripted resolvers return the same `ResolvedInputs` shape
- Scripted resolver: fail fast with `UsageError` or `ValidationError`, never prompt
- Interactive resolver: use the wizard step pattern (BACK/CANCEL navigation)
- File uploads happen later in the execution layer — resolvers just collect paths/URLs
