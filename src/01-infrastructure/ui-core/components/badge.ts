import type { ColorManager } from '../color.ts';

export interface BadgeOptions {
  color: ColorManager;
  bgColor?: string;
  plain?: boolean;
}

// Foundation design-system colors (dark mode)
const PRESET_COLORS: Record<string, string> = {
  image: '#BD99F8', // secondary
  video: '#BD99F8', // secondary
  audio: '#64ED68', // success
  new: '#64ED68', // success
  hot: '#FFC13C', // warning
  popular: '#FFC13C', // warning
  premium: '#E859B4', // primary
  pro: '#E859B4', // primary
  fast: '#BD99F8', // secondary
  beta: '#FFC13C', // warning
  t2i: '#7A7A7A', // placeholder
  i2v: '#7A7A7A',
  t2v: '#7A7A7A',
  v2v: '#7A7A7A',
  i2i: '#7A7A7A',
  tts: '#7A7A7A',
  sfx: '#7A7A7A',
  music: '#7A7A7A',
};

export type BadgePreset = keyof typeof PRESET_COLORS;

const FALLBACK_COLOR = '#7A7A7A';

export function renderBadge(text: string, opts: BadgeOptions): string {
  const { color, plain = false } = opts;
  const padded = ` ${text} `;

  if (plain) {
    return `[${text}]`;
  }

  if (!color.enabled || !opts.bgColor) {
    return padded;
  }

  return color.hex(opts.bgColor)(padded);
}

export function renderPresetBadge(preset: string, opts: Omit<BadgeOptions, 'bgColor'>): string {
  const bgColor = PRESET_COLORS[preset] ?? FALLBACK_COLOR;
  return renderBadge(preset, { ...opts, bgColor });
}
