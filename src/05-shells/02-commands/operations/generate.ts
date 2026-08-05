/**
 * `gen-ai generate` — see `FLOWS['generate']` for everything declarative
 * about this command. The entire orchestration lives in the builder.
 *
 * Universal entry point: accepts any non-disabled model. Specialized
 * flows (`gen-ai image`, `gen-ai video`, …) are the preferred way to
 * invoke a known category; this one is for discovery and one-off use.
 */
import { FLOWS } from '#flows';
import { createOperationCommand } from '../../01-command-builder/builder.ts';

export default createOperationCommand(FLOWS.generate);
