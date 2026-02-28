/**
 * CLI vocabulary mapping — thematic (default) vs plain English.
 *
 * Thematic mode (default): Japanese karate-inspired terminology.
 * Plain mode (--plain / KATA_PLAIN=1 / config outputMode: plain):
 *   standard English equivalents.
 */
export interface Lexicon {
  /** stage (research/plan/build/review) */
  stage: string;
  /** step — atomic methodology unit */
  step: string;
  /** flavor — named composition of steps */
  flavor: string;
  /** cycle — time-boxed work period */
  cycle: string;
  /** gate — threshold/condition */
  gate: string;
  /** entry gate */
  entryGate: string;
  /** exit gate */
  exitGate: string;
  /** decision — the decisive moment */
  decision: string;
  /** knowledge / learning store */
  knowledge: string;
  /** cooldown — reflection period */
  cooldown: string;
  /** execute — run stage orchestration */
  execute: string;
  /** dojo — personal training environment */
  dojo: string;
  /** config — methodology editor */
  config: string;
}

/** Thematic lexicon (default): Japanese karate-inspired terms. */
export const THEMATIC: Lexicon = {
  stage: 'gyo',
  step: 'waza',
  flavor: 'ryu',
  cycle: 'keiko',
  gate: 'mon',
  entryGate: 'iri-mon',
  exitGate: 'de-mon',
  decision: 'kime',
  knowledge: 'bunkai',
  cooldown: 'ma',
  execute: 'kiai',
  dojo: 'dojo',
  config: 'seido',
};

/** Plain lexicon: standard English equivalents. */
export const PLAIN: Lexicon = {
  stage: 'stage',
  step: 'step',
  flavor: 'flavor',
  cycle: 'cycle',
  gate: 'gate',
  entryGate: 'entry gate',
  exitGate: 'exit gate',
  decision: 'decision',
  knowledge: 'knowledge',
  cooldown: 'cooldown',
  execute: 'execute',
  dojo: 'dojo',
  config: 'config',
};

/**
 * Return the appropriate lexicon based on the plain flag.
 * @param plain - true for English output, false/undefined for thematic (default)
 */
export function getLexicon(plain?: boolean): Lexicon {
  return plain ? PLAIN : THEMATIC;
}

/**
 * Capitalize the first letter of each word in a string.
 * Handles both space-separated ("entry gate" → "Entry Gate") and
 * hyphenated ("iri-mon" → "Iri-Mon") word boundaries.
 */
export function cap(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Return the plural form of a lexicon word.
 * In plain mode, appends "s" (optionally count-aware — skips when count === 1).
 * In thematic mode, returns the word unchanged: Japanese words do not pluralise with "s".
 *
 * @param word  - the lexicon term, already capitalised if desired
 * @param plain - true for plain English mode
 * @param count - optional count for count-aware pluralisation
 */
export function pl(word: string, plain?: boolean, count?: number): string {
  if (!plain) return word;
  if (count !== undefined && count === 1) return word;
  return word + 's';
}
