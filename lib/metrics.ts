/**
 * Cheap, deterministic stats computed from a saved talk's transcript, fed to the
 * feedback model so it can comment on delivery accurately instead of guessing.
 *
 * These are text-only. Pause length and reliable filler detection really live in
 * the audio (timestamps), which the current recorder does not persist — so
 * `fillerCount` is best-effort and pauses are deliberately absent until we
 * re-transcribe the saved file with word timings. See lib/feedback.ts.
 */
export interface TalkMetrics {
  /** Total words spoken. */
  wordCount: number;
  /** Words per minute over the talk's duration; 0 when duration is unknown. */
  wpm: number;
  /** Filler words/phrases found in the transcript. Often 0 — STT tends to strip them. */
  fillerCount: number;
}

/**
 * Conservative filler list: only tokens that are almost always fillers. "like",
 * "so" and "actually" are excluded on purpose — they are too often real words to
 * count without word-level context, and a false "you say 'like' a lot" is worse
 * than missing a few.
 */
const FILLER_PHRASES = [
  'um',
  'uh',
  'erm',
  'uhh',
  'hmm',
  'you know',
  'i mean',
  'kind of',
  'sort of',
];

function countFillers(transcript: string): number {
  const haystack = ` ${transcript.toLowerCase()} `;
  let total = 0;
  for (const phrase of FILLER_PHRASES) {
    // Whole-word match, allowing flexible whitespace inside multi-word phrases.
    const pattern = new RegExp(`\\b${phrase.replace(/ /g, '\\s+')}\\b`, 'g');
    total += (haystack.match(pattern) ?? []).length;
  }
  return total;
}

export function computeMetrics(
  transcript: string,
  durationSeconds: number | null,
): TalkMetrics {
  const words = transcript.trim().split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  const minutes = durationSeconds && durationSeconds > 0 ? durationSeconds / 60 : 0;
  const wpm = minutes > 0 ? Math.round(wordCount / minutes) : 0;
  return { wordCount, wpm, fillerCount: countFillers(transcript) };
}
