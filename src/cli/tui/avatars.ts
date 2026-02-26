import type { StageCategory } from '@domain/types/stage.js';

export type AvatarState = { stage: StageCategory | 'completed' };

const STAGE_AVATARS = {
  research: '🧘',
  plan: '🤺',
  build: '⚔️',
  review: '🔍',
  completed: '🏆',
} satisfies Record<StageCategory | 'completed', string>;

const NERD_FONT_ICONS = {
  research: '\uF002', // fa-search
  plan: '\uF044',     // fa-pencil-square-o
  build: '\uF0AD',    // fa-wrench
  review: '\uF06E',   // fa-eye
} satisfies Record<StageCategory, string>;

const ASCII_FALLBACK = {
  research: '[R]',
  plan: '[P]',
  build: '[B]',
  review: '[V]',
} satisfies Record<StageCategory, string>;

const BET_COLORS = ['cyan', 'magenta', 'yellow', 'green', 'blue', 'red'] as const;
export type BetColor = (typeof BET_COLORS)[number];

export function getAvatar(stage: StageCategory | 'completed'): string {
  return STAGE_AVATARS[stage];
}

function hashBetId(betId: string): number {
  let hash = 0;
  for (let i = 0; i < betId.length; i++) {
    hash = ((hash * 31) + betId.charCodeAt(i)) >>> 0;
  }
  return hash;
}

export function getBetColor(betId: string): BetColor {
  const idx = hashBetId(betId) % BET_COLORS.length;
  return BET_COLORS[idx] ?? 'cyan';
}

export function getStageIcon(stage: StageCategory, opts?: { nerdFonts?: boolean }): string {
  const useNerd = opts?.nerdFonts ?? process.env['KATA_NO_NERD_FONTS'] !== '1';
  if (useNerd) {
    return NERD_FONT_ICONS[stage];
  }
  return ASCII_FALLBACK[stage];
}
