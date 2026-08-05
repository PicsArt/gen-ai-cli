/**
 * Explicit command manifest for oclif.
 * Used by the "explicit" discovery strategy so tsup can bundle
 * everything into a single file without breaking command discovery.
 */
import type { Command } from '@oclif/core';
import Login from './05-shells/02-commands/auth/login.ts';
import Logout from './05-shells/02-commands/auth/logout.ts';
import Whoami from './05-shells/02-commands/auth/whoami.ts';
import BatchResume from './05-shells/02-commands/batch/resume.ts';
import BatchRun from './05-shells/02-commands/batch/run.ts';
import BatchSchema from './05-shells/02-commands/batch/schema.ts';
import BatchStatus from './05-shells/02-commands/batch/status.ts';
import CheckSkills from './05-shells/02-commands/check-skills.ts';
import Completion from './05-shells/02-commands/completion.ts';
import ConfigGet from './05-shells/02-commands/config/get.ts';
import ConfigKeys from './05-shells/02-commands/config/keys.ts';
import ConfigList from './05-shells/02-commands/config/list.ts';
import ConfigSet from './05-shells/02-commands/config/set.ts';
import ConfigUnset from './05-shells/02-commands/config/unset.ts';
import Credits from './05-shells/02-commands/credits.ts';
import DevParams from './05-shells/02-commands/dev/params.ts';
import Download from './05-shells/02-commands/drive/download.ts';
import List from './05-shells/02-commands/drive/list.ts';
import Upload from './05-shells/02-commands/drive/upload.ts';
import HistoryClear from './05-shells/02-commands/history/clear.ts';
import HistoryFiles from './05-shells/02-commands/history/files.ts';
import HistoryList from './05-shells/02-commands/history/index.ts';
import HistoryLast from './05-shells/02-commands/history/last.ts';
import InstallSkills from './05-shells/02-commands/install-skills.ts';
import Compare from './05-shells/02-commands/meta/compare.ts';
import Extend from './05-shells/02-commands/meta/extend.ts';
import Redo from './05-shells/02-commands/meta/redo.ts';
import Replay from './05-shells/02-commands/meta/replay.ts';
import ModelsCompare from './05-shells/02-commands/models/compare.ts';
import ModelsList from './05-shells/02-commands/models/index.ts';
import ModelsInfo from './05-shells/02-commands/models/info.ts';
import Ask from './05-shells/02-commands/operations/ask.ts';
import AudioFromText from './05-shells/02-commands/operations/audio-from-text.ts';
import ChangeBg from './05-shells/02-commands/operations/change-bg.ts';
import Character from './05-shells/02-commands/operations/character.ts';
import Describe from './05-shells/02-commands/operations/describe.ts';
import EditImage from './05-shells/02-commands/operations/edit-image.ts';
import Enhance from './05-shells/02-commands/operations/enhance.ts';
import Generate from './05-shells/02-commands/operations/generate.ts';
import Image from './05-shells/02-commands/operations/image.ts';
import ImageToVideo from './05-shells/02-commands/operations/image-to-video.ts';
import MultiImage from './05-shells/02-commands/operations/multi-image.ts';
import Music from './05-shells/02-commands/operations/music.ts';
import RemoveBg from './05-shells/02-commands/operations/remove-bg.ts';
import Sfx from './05-shells/02-commands/operations/sfx.ts';
import TalkingPhoto from './05-shells/02-commands/operations/talking-photo.ts';
import TextToSpeech from './05-shells/02-commands/operations/text-to-speech.ts';
import Upscale from './05-shells/02-commands/operations/upscale.ts';
import Vectorize from './05-shells/02-commands/operations/vectorize.ts';
import Video from './05-shells/02-commands/operations/video.ts';
import VideoAudio from './05-shells/02-commands/operations/video-audio.ts';
import VideoEdit from './05-shells/02-commands/operations/video-edit.ts';
import VoiceClone from './05-shells/02-commands/operations/voice-clone.ts';
import Pricing from './05-shells/02-commands/pricing.ts';
import Update from './05-shells/02-commands/update.ts';
import UploadToDrive from './05-shells/02-commands/upload-to-drive.ts';
import Validate from './05-shells/02-commands/validate.ts';
import Version from './05-shells/02-commands/version.ts';

export const COMMANDS: Record<string, Command.Class> = {
  login: Login,
  logout: Logout,
  whoami: Whoami,
  generate: Generate,
  redo: Redo,
  replay: Replay,
  compare: Compare,
  extend: Extend,
  completion: Completion,
  download: Download,
  upload: Upload,
  list: List,
  pricing: Pricing,
  validate: Validate,
  models: ModelsList,
  'models:info': ModelsInfo,
  'models:compare': ModelsCompare,
  'config:get': ConfigGet,
  'config:set': ConfigSet,
  'config:list': ConfigList,
  'config:keys': ConfigKeys,
  'config:unset': ConfigUnset,
  'batch:run': BatchRun,
  'batch:status': BatchStatus,
  'batch:resume': BatchResume,
  'batch:schema': BatchSchema,
  history: HistoryList,
  'history:last': HistoryLast,
  'history:files': HistoryFiles,
  'history:clear': HistoryClear,
  update: Update,
  version: Version,
  credits: Credits,
  'dev:params': DevParams,
  // ── Operations (one per FLOW) ──────────────────────────────────
  // InputType-only flows
  video: Video,
  image: Image,
  'image-to-video': ImageToVideo,
  'video-edit': VideoEdit,
  'talking-photo': TalkingPhoto,
  'text-to-speech': TextToSpeech,
  'voice-clone': VoiceClone,
  music: Music,
  sfx: Sfx,
  'video-audio': VideoAudio,
  'audio-from-text': AudioFromText,
  // i2i sub-category flows
  'remove-bg': RemoveBg,
  'change-bg': ChangeBg,
  enhance: Enhance,
  upscale: Upscale,
  vectorize: Vectorize,
  'edit-image': EditImage,
  character: Character,
  'multi-image': MultiImage,
  // text/LLM models (mode === 'text')
  describe: Describe,
  ask: Ask,
  // ── Shared utilities ────────────────────────────────────────────
  'upload-to-drive': UploadToDrive,
  'install-skills': InstallSkills,
  'check-skills': CheckSkills,
};
