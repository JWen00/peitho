import { supabase } from './supabase';

/** One transcribed word with its timing, in seconds. */
export interface TimedWord {
  text: string;
  start: number;
  end: number;
}

export interface Transcription {
  text: string;
  words: TimedWord[];
}

/**
 * Re-transcribes a saved talk's audio via the `transcribe` edge function
 * (ElevenLabs Scribe) to get word-level timestamps — the raw material for
 * accurate filler and pause metrics. The function calls ElevenLabs only the
 * first time per talk and serves the stored result after that.
 *
 * Throws on failure (no key configured, network, etc.) so the caller can fall
 * back to the cleaned on-device transcript.
 */
export async function transcribeTalk(talkId: string): Promise<Transcription> {
  console.log(`[transcribe] → /transcribe for talk ${talkId}`);
  const { data, error } = await supabase.functions.invoke<Transcription>('transcribe', {
    body: { talkId },
  });
  if (error) {
    console.warn('[transcribe] ✗ failed:', error);
    throw error;
  }
  if (!data) throw new Error('Transcription returned no data.');
  console.log(
    `[transcribe] ✓ ${data.words?.length ?? 0} words, ${data.text?.length ?? 0} chars`,
    data.text?.slice(0, 120),
  );
  return { text: data.text ?? '', words: data.words ?? [] };
}
