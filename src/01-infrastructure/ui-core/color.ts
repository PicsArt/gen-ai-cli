import { Chalk, type ChalkInstance, supportsColor, supportsColorStderr } from 'chalk';
import { stripAnsi } from './components/string-utils.ts';

const BRAND_PRIMARY = '#E859B4';
const BRAND_SECONDARY = '#BD99F8';
const BRAND_PURPLE = '#9A1A89';

const COLOR_SUCCESS = '#64ED68';
const COLOR_ERROR = '#F8495A';
const COLOR_WARNING = '#FFC13C';
const COLOR_INFO = '#BD99F8';

export interface ColorManager {
  enabled: boolean;
  red(text: string): string;
  green(text: string): string;
  yellow(text: string): string;
  blue(text: string): string;
  magenta(text: string): string;
  cyan(text: string): string;
  bold(text: string): string;
  dim(text: string): string;
  italic(text: string): string;
  underline(text: string): string;
  brand(text: string): string;
  brandMagenta(text: string): string;
  brandPurple(text: string): string;
  hex(color: string): (text: string) => string;
  strip(text: string): string;
  /** Wrap text in an OSC 8 clickable hyperlink (supported by most modern terminals). */
  link(text: string, url: string): string;
  success(text: string): string;
  error(text: string): string;
  warning(text: string): string;
  info(text: string): string;
}

function shouldDisableColor(): boolean {
  if (process.env.NO_COLOR && process.env.NO_COLOR !== '') return true;
  if (process.env.GEN_AI_NO_COLOR && process.env.GEN_AI_NO_COLOR !== '') return true;
  if (process.env.TERM === 'dumb') return true;
  // Colorized UI goes to both streams (diagnostics, cards, and prompts are
  // written to stderr) — only disable when neither is a terminal, so
  // `cmd > file` keeps colored stderr output.
  if (!process.stdout.isTTY && !process.stderr.isTTY) return true;
  return false;
}

function noopColor(text: string): string {
  return text;
}

// Both OSC 8 payload slots are interpolated into a raw escape sequence, so an
// embedded BEL/ESC in an untrusted URL (drive metadata, provider responses)
// would terminate the sequence early and inject arbitrary terminal escapes.
// eslint-disable-next-line no-control-regex
const OSC_UNSAFE_RE = /[\0-\x1f\x7f-\x9f]/g;

function sanitizeOscField(value: string): string {
  return value.replace(OSC_UNSAFE_RE, '');
}

function createDisabledManager(): ColorManager {
  return {
    enabled: false,
    red: noopColor,
    green: noopColor,
    yellow: noopColor,
    blue: noopColor,
    magenta: noopColor,
    cyan: noopColor,
    bold: noopColor,
    dim: noopColor,
    italic: noopColor,
    underline: noopColor,
    brand: noopColor,
    brandMagenta: noopColor,
    brandPurple: noopColor,
    hex: () => noopColor,
    strip: stripAnsi,
    link: (text) => text,
    success: noopColor,
    error: noopColor,
    warning: noopColor,
    info: noopColor,
  };
}

function createEnabledManager(): ColorManager {
  // Respect the terminal's actual color capability instead of forcing
  // truecolor — 24-bit SGR sequences render as garbage on 16/256-color
  // terminals. UI goes to both stdout and stderr, so take the better of the
  // two detections; floor at level 1 since the enable decision is already made.
  const detected = Math.max(
    supportsColor ? supportsColor.level : 0,
    supportsColorStderr ? supportsColorStderr.level : 0,
  );
  const c: ChalkInstance = new Chalk({ level: Math.max(1, detected) as 1 | 2 | 3 });
  return {
    enabled: true,
    red: (t) => c.red(t),
    green: (t) => c.green(t),
    yellow: (t) => c.yellow(t),
    blue: (t) => c.blue(t),
    magenta: (t) => c.magenta(t),
    cyan: (t) => c.cyan(t),
    bold: (t) => c.bold(t),
    dim: (t) => c.dim(t),
    italic: (t) => c.italic(t),
    underline: (t) => c.underline(t),
    brand: (t) => c.hex(BRAND_PRIMARY)(t),
    brandMagenta: (t) => c.hex(BRAND_SECONDARY)(t),
    brandPurple: (t) => c.hex(BRAND_PURPLE)(t),
    success: (t) => c.hex(COLOR_SUCCESS)(t),
    error: (t) => c.hex(COLOR_ERROR)(t),
    warning: (t) => c.hex(COLOR_WARNING)(t),
    info: (t) => c.hex(COLOR_INFO)(t),
    hex: (color) => (t) => c.hex(color)(t),
    strip: stripAnsi,
    link: (text, url) => `\u001B]8;;${sanitizeOscField(url)}\u0007${sanitizeOscField(text)}\u001B]8;;\u0007`,
  };
}

export interface ColorManagerOptions {
  enabled: boolean | 'auto';
  noColorFlag?: boolean;
}

let _instance: ColorManager | null = null;

export function createColorManager(opts: ColorManagerOptions): ColorManager {
  let disabled: boolean;
  if (opts.noColorFlag) {
    disabled = true;
  } else if (opts.enabled === 'auto') {
    disabled = shouldDisableColor();
  } else {
    disabled = !opts.enabled;
  }

  _instance = disabled ? createDisabledManager() : createEnabledManager();
  return _instance;
}

export function getColor(): ColorManager {
  if (!_instance) {
    _instance = createColorManager({ enabled: 'auto' });
  }
  return _instance;
}
