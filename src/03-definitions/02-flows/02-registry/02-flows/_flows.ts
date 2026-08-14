/**
 * Flow registry — every declared flow is re-exported here so the
 * composer / CLI bootstrap can iterate without knowing each filename.
 *
 * Adding a new flow:
 *   1. Drop a `NN-<id>/<id>.ts` folder + file under this directory.
 *   2. Add one entry below.
 *
 * `FLOWS` is keyed by `FlowSpec.id` — the value the user types as
 * `gen-ai <id>`. The keys here MUST match each spec's `id` field
 * (asserted in `_flows.test.ts`).
 */
import { GENERATE_FLOW } from './00-generate/generate.ts';
import { VIDEO_FLOW } from './01-video/video.ts';
import { IMAGE_FLOW } from './02-image/image.ts';
import { IMAGE_TO_VIDEO_FLOW } from './03-image-to-video/image-to-video.ts';
import { VIDEO_EDIT_FLOW } from './04-video-edit/video-edit.ts';
import { TALKING_PHOTO_FLOW } from './05-talking-photo/talking-photo.ts';
import { TEXT_TO_SPEECH_FLOW } from './06-text-to-speech/text-to-speech.ts';
import { VOICE_CLONE_FLOW } from './07-voice-clone/voice-clone.ts';
import { MUSIC_FLOW } from './08-music/music.ts';
import { SFX_FLOW } from './09-sfx/sfx.ts';
import { VIDEO_AUDIO_FLOW } from './10-video-audio/video-audio.ts';
import { AUDIO_FROM_TEXT_FLOW } from './11-audio-from-text/audio-from-text.ts';
import { REMOVE_BG_FLOW } from './12-remove-bg/remove-bg.ts';
import { CHANGE_BG_FLOW } from './13-change-bg/change-bg.ts';
import { ENHANCE_FLOW } from './14-enhance/enhance.ts';
import { UPSCALE_FLOW } from './15-upscale/upscale.ts';
import { VECTORIZE_FLOW } from './16-vectorize/vectorize.ts';
import { EDIT_IMAGE_FLOW } from './17-edit-image/edit-image.ts';
import { CHARACTER_FLOW } from './18-character/character.ts';
import { MULTI_IMAGE_FLOW } from './19-multi-image/multi-image.ts';
import { EXTEND_FLOW } from './20-extend/extend.ts';
import { DESCRIBE_FLOW } from './21-describe/describe.ts';
import { ASK_FLOW } from './22-ask/ask.ts';

export const FLOWS = {
  // Universal entry — accepts every non-disabled model
  generate: GENERATE_FLOW,

  // InputType-only flows (one InputType ⇒ one flow)
  video: VIDEO_FLOW,
  image: IMAGE_FLOW,
  'image-to-video': IMAGE_TO_VIDEO_FLOW,
  'video-edit': VIDEO_EDIT_FLOW,
  'talking-photo': TALKING_PHOTO_FLOW,
  'text-to-speech': TEXT_TO_SPEECH_FLOW,
  'voice-clone': VOICE_CLONE_FLOW,
  music: MUSIC_FLOW,
  sfx: SFX_FLOW,
  'video-audio': VIDEO_AUDIO_FLOW,
  'audio-from-text': AUDIO_FROM_TEXT_FLOW,

  // i2i sub-categories (filter on workflow/id pattern)
  'remove-bg': REMOVE_BG_FLOW,
  'change-bg': CHANGE_BG_FLOW,
  enhance: ENHANCE_FLOW,
  upscale: UPSCALE_FLOW,
  vectorize: VECTORIZE_FLOW,
  'edit-image': EDIT_IMAGE_FLOW,
  character: CHARACTER_FLOW,
  'multi-image': MULTI_IMAGE_FLOW,

  // v2v sub-category (filter on workflow/id pattern)
  extend: EXTEND_FLOW,

  // text/LLM models (mode === 'text')
  describe: DESCRIBE_FLOW, // media analysis (image/video → text)
  ask: ASK_FLOW, // general LLM (text in, optional media → text)
} as const;

export type FlowId = keyof typeof FLOWS;
