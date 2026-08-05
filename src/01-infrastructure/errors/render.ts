import { CliError, ExitCode } from './base.ts';

/**
 * Thrown when video composition fails — ffmpeg subprocess error, Remotion
 * bundle/render failure, or any other "the renderer broke" condition. Carries
 * the stage label (`ffmpeg`, `ffprobe`, `remotion`) and the underlying cause.
 */
export class RenderError extends CliError {
  readonly exitCode = ExitCode.RENDER_ERROR;
  readonly stage: string;
  readonly cause: unknown;

  constructor(stage: string, cause: unknown) {
    const causeMsg = cause instanceof Error ? cause.message : String(cause);
    super(`Render stage "${stage}" failed: ${causeMsg}`);
    this.stage = stage;
    this.cause = cause;
    this.hint = `Check the run dir for the per-stage log. Re-run the command to retry.`;
  }

  get friendlyMessage(): string {
    const causeMsg = this.cause instanceof Error ? this.cause.message : String(this.cause);
    return `Render stage "${this.stage}" failed: ${causeMsg}`;
  }
}
