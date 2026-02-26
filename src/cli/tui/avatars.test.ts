import { describe, it, expect, afterEach, vi } from 'vitest';
import { getAvatar, getBetColor, getStageIcon } from './avatars.js';

describe('getAvatar', () => {
  it('returns 🧘 for research', () => {
    expect(getAvatar('research')).toBe('🧘');
  });

  it('returns 🤺 for plan', () => {
    expect(getAvatar('plan')).toBe('🤺');
  });

  it('returns ⚔️ for build', () => {
    expect(getAvatar('build')).toBe('⚔️');
  });

  it('returns 🔍 for review', () => {
    expect(getAvatar('review')).toBe('🔍');
  });

  it('returns 🏆 for completed', () => {
    expect(getAvatar('completed')).toBe('🏆');
  });
});

describe('getBetColor', () => {
  const validColors = ['cyan', 'magenta', 'yellow', 'green', 'blue', 'red'];

  it('returns a valid color for any betId', () => {
    expect(validColors).toContain(getBetColor('some-bet-id'));
  });

  it('returns the same color for the same betId', () => {
    expect(getBetColor('bet-123')).toBe(getBetColor('bet-123'));
  });

  it('uses at most 6 distinct colors across many betIds', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) {
      seen.add(getBetColor(`bet-${i}`));
    }
    expect(seen.size).toBeLessThanOrEqual(6);
  });

  it('all returned colors are from the valid palette', () => {
    for (let i = 0; i < 20; i++) {
      expect(validColors).toContain(getBetColor(`id-${i}`));
    }
  });
});

describe('getStageIcon', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns ASCII fallback when nerdFonts opt is false', () => {
    expect(getStageIcon('research', { nerdFonts: false })).toBe('[R]');
    expect(getStageIcon('plan', { nerdFonts: false })).toBe('[P]');
    expect(getStageIcon('build', { nerdFonts: false })).toBe('[B]');
    expect(getStageIcon('review', { nerdFonts: false })).toBe('[V]');
  });

  it('returns a nerd font string when nerdFonts opt is true', () => {
    const icon = getStageIcon('research', { nerdFonts: true });
    expect(typeof icon).toBe('string');
    expect(icon.length).toBeGreaterThan(0);
  });

  it('uses KATA_NO_NERD_FONTS=1 env var as fallback when no opts provided', () => {
    vi.stubEnv('KATA_NO_NERD_FONTS', '1');
    expect(getStageIcon('research')).toBe('[R]');
    expect(getStageIcon('plan')).toBe('[P]');
    expect(getStageIcon('build')).toBe('[B]');
    expect(getStageIcon('review')).toBe('[V]');
  });

  it('uses nerd fonts when KATA_NO_NERD_FONTS is unset', () => {
    vi.stubEnv('KATA_NO_NERD_FONTS', '');
    const icon = getStageIcon('research');
    expect(typeof icon).toBe('string');
    expect(icon).not.toBe('[R]');
  });
});
