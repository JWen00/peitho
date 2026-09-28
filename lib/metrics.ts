import type { TimedWord } from './transcribe';

/**
 * Cheap, deterministic stats fed to the feedback model so it can comment on
 * delivery accurately instead of guessing.
 *
 * Two sources: {@link computeMetrics} from a plain transcript (text only — no
 * pauses, and fillers are best-effort since on-device STT strips them), and
 * {@link computeMetricsFromWords} from ElevenLabs word timings, which give real
 * pause lengths and catch fillers the cleaned transcript dropped.
 */
export interface TalkMetrics {
  /** Total words spoken. */
  wordCount: number;
  /** Words per minute over the talk's duration; 0 when duration is unknown. */
  wpm: number;
  /** Filler words/phrases found in the transcript. */
  fillerCount: number;
  /** Longest silent gap between words, in seconds; null when timings are absent. */
  maxPauseSeconds: number | null;
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

/** Text-only metrics (no timings): pauses are unknown, fillers best-effort. */
export function computeMetrics(
  transcript: string,
  durationSeconds: number | null,
): TalkMetrics {
  const words = transcript.trim().split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  const minutes = durationSeconds && durationSeconds > 0 ? durationSeconds / 60 : 0;
  const wpm = minutes > 0 ? Math.round(wordCount / minutes) : 0;
  return { wordCount, wpm, fillerCount: countFillers(transcript), maxPauseSeconds: null };
}

/** Round to one decimal place. */
function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Metrics from ElevenLabs word timings: real WPM and the longest inter-word
 * pause, plus fillers counted from the raw (uncleaned) transcript.
 */
export function computeMetricsFromWords(
  text: string,
  words: TimedWord[],
  durationSeconds: number | null,
): TalkMetrics {
  const wordCount = words.length || text.trim().split(/\s+/).filter(Boolean).length;

  // Prefer the recorded duration; fall back to the span the words cover.
  const span = words.length >= 2 ? words[words.length - 1].end - words[0].start : 0;
  const seconds = durationSeconds && durationSeconds > 0 ? durationSeconds : span;
  const minutes = seconds > 0 ? seconds / 60 : 0;
  const wpm = minutes > 0 ? Math.round(wordCount / minutes) : 0;

  let maxPause = 0;
  for (let i = 1; i < words.length; i += 1) {
    const gap = words[i].start - words[i - 1].end;
    if (gap > maxPause) maxPause = gap;
  }

  return {
    wordCount,
    wpm,
    fillerCount: countFillers(text),
    maxPauseSeconds: words.length >= 2 ? round1(maxPause) : null,
  };
}
