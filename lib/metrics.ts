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
/** A vague adjective the speaker leaned on, with how many times it appeared. */
export interface VagueWord {
  word: string;
  count: number;
}

export interface TalkMetrics {
  /** Total words spoken. */
  wordCount: number;
  /** Words per minute over the talk's duration; 0 when duration is unknown. */
  wpm: number;
  /** Filler words/phrases found in the transcript. */
  fillerCount: number;
  /** Longest silent gap between words, in seconds; null when timings are absent. */
  maxPauseSeconds: number | null;
  /** Vague catch-all adjectives used, most-used first — material for word-choice feedback. */
  vagueWords: VagueWord[];
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

/**
 * Vague catch-all adjectives worth replacing with something specific. Flagged so
 * the language coach can name the exact words the speaker overused.
 */
const VAGUE_WORDS = [
  'good',
  'bad',
  'nice',
  'interesting',
  'great',
  'hard',
  'important',
  'small',
  'different',
  'weird',
  'cool',
  'beautiful',
  'ugly',
  'fast',
  'slow',
  'busy',
  'boring',
  'smart',
  'strong',
  'weak',
];

/** Which vague words appeared (with counts), most-used first. */
function findVagueWords(transcript: string): VagueWord[] {
  const haystack = ` ${transcript.toLowerCase()} `;
  const found: VagueWord[] = [];
  for (const word of VAGUE_WORDS) {
    const count = (haystack.match(new RegExp(`\\b${word}\\b`, 'g')) ?? []).length;
    if (count > 0) found.push({ word, count });
  }
  return found.sort((a, b) => b.count - a.count);
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
  return {
    wordCount,
    wpm,
    fillerCount: countFillers(transcript),
    maxPauseSeconds: null,
    vagueWords: findVagueWords(transcript),
  };
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
    vagueWords: findVagueWords(text),
  };
}
