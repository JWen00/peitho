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
 * accurate filler and pause metrics.
 *
 * Throws on failure (no key configured, network, etc.) so the caller can fall
 * back to the cleaned on-device transcript.
 */
export async function transcribeTalk(talkId: string): Promise<Transcription> {
  const { data, error } = await supabase.functions.invoke<Transcription>('transcribe', {
    body: { talkId },
  });
  if (error) throw error;
  if (!data) throw new Error('Transcription returned no data.');
  return { text: data.text ?? '', words: data.words ?? [] };
}
