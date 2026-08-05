/**
 * `gen-ai video` — see `FLOWS['video']` for everything declarative about
 * this command. The entire orchestration lives in the builder.
 */
import { FLOWS } from '#flows';
import { createOperationCommand } from '../../01-command-builder/builder.ts';

export default createOperationCommand(FLOWS.video);
