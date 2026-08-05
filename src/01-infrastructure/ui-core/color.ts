import { Chalk, type ChalkInstance } from 'chalk';
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
  if (!process.stdout.isTTY) return true;
  return false;
}

function noopColor(text: string): string {
  return text;
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
  const c: ChalkInstance = new Chalk({ level: 3 });
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
    link: (text, url) => `\u001B]8;;${url}\u0007${text}\u001B]8;;\u0007`,
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
