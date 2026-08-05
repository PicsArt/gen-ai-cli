/**
 * I/O entry point for the file-wiring auditor. The pure
 * `findFileWiringGaps` function takes pre-read sources as strings — this
 * helper does the actual disk reads so both the standalone script
 * (`scripts/audit-params.ts`) and the oclif command (`gen-ai dev:params`)
 * share a single source-path contract.
 *
 * If the resolver/execute/validate paths ever move, update them HERE and
 * both callers stay in sync.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ResolverSources } from './file-wiring.ts';

/** Paths are relative to `src/`. */
const RESOLVER_PATH = '04-pipeline/02-resolve/scripted/resolver.ts';
const EXECUTE_PATH = '04-pipeline/03-execution/execute.ts';
const VALIDATE_PATH = '04-pipeline/03-execution/validate.ts';

/** Anchor on this module's own location and walk up to `src/`. */
function cliSrcRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // here = src/03-definitions/01-param-surface/05-audit
  // walk up three levels to land at src/
  return resolve(here, '..', '..', '..');
}

/**
 * Read the three pipeline source files the auditor inspects.
 * Synchronous — the auditor is a one-shot CLI tool.
 */
export function readResolverSources(): ResolverSources {
  const root = cliSrcRoot();
  return {
    resolver: readFileSync(resolve(root, RESOLVER_PATH), 'utf-8'),
    execute: readFileSync(resolve(root, EXECUTE_PATH), 'utf-8'),
    validate: readFileSync(resolve(root, VALIDATE_PATH), 'utf-8'),
  };
}
