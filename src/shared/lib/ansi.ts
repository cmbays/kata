/**
 * Tiny ANSI color helper. Respects NO_COLOR env and non-TTY stdout.
 * All functions are pass-through when color is disabled.
 */

const enabled = !process.env['NO_COLOR'] && !!process.stdout.isTTY;

function wrap(open: number, close: number) {
  return (s: string): string =>
    enabled ? `\u001b[${open}m${s}\u001b[${close}m` : s;
}

export const bold = wrap(1, 22);
export const dim = wrap(2, 22);
export const cyan = wrap(36, 39);
export const green = wrap(32, 39);
export const yellow = wrap(33, 39);
export const red = wrap(31, 39);
export const magenta = wrap(35, 39);
export const blue = wrap(34, 39);

/** Strip all ANSI escape codes — useful in tests or when piping output. */
const ANSI_RE = new RegExp(String.fromCharCode(0x1b) + '\\[[0-9;]*m', 'g');
export function strip(s: string): string {
  return s.replace(ANSI_RE, '');
}

/**
 * Like String.padEnd, but measures visible width (ignoring ANSI codes).
 * Use this when padding strings that may already contain color codes.
 */
export function visiblePadEnd(s: string, width: number): string {
  const padding = Math.max(0, width - strip(s).length);
  return s + ' '.repeat(padding);
}
