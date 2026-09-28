/**
 * The transcribe API.
 *
 *   POST /transcribe   { talkId }  ->  { text, words: [{ text, start, end }] }
 *
 * Re-transcribes a saved talk's audio with ElevenLabs Scribe to get word-level
 * timestamps — the raw material the app needs for accurate filler and pause
 * metrics, which the on-device live transcript (cleaned, no timings) cannot give.
 *
 * The ElevenLabs key lives only here, as the `ELEVEN_API_KEY` secret; it must
 * never reach the app bundle. The route is `auth: 'user'`, so `ctx.supabase` is
 * scoped to the caller by RLS and a talk id only resolves to the caller's own row.
 */
import { Hono } from 'npm:hono@^4.6.0';
import { cors } from 'npm:hono@^4.6.0/cors';
import { HTTPException } from 'npm:hono@^4.6.0/http-exception';
import { withSupabase } from 'npm:@supabase/server@^1.7.0/adapters/hono';
import { AuthError } from 'npm:@supabase/server@^1.7.0';

import type { Database } from '../../../lib/database.types.ts';

const BUCKET = 'recordings';

/** ElevenLabs on-device-quality STT with word timestamps. */
const ELEVENLABS_STT_URL = 'https://api.elevenlabs.io/v1/speech-to-text';
const SCRIBE_MODEL = 'scribe_v1';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One transcribed word with its timing, in seconds. */
interface TimedWord {
  text: string;
  start: number;
  end: number;
}

/** The subset of the ElevenLabs response we consume. */
interface ScribeResponse {
  text?: string;
  words?: { text?: string; start?: number; end?: number; type?: string }[];
}

const app = new Hono().basePath('/transcribe');

app.use('*', cors());
app.use('*', withSupabase<Database>({ auth: 'user' }));

class BadRequest extends Error {}

app.post('/', async (c) => {
  const apiKey = Deno.env.get('ELEVEN_API_KEY');
  if (!apiKey) {
    // A deployment problem, not the caller's fault — log the specifics, tell the
    // client only that transcription is unavailable.
    console.error('transcribe: ELEVEN_API_KEY is not set');
    throw new HTTPException(503, { message: 'Transcription is not configured.' });
  }

  const { supabase } = c.var.supabaseContext;

  const body = await c.req.json().catch(() => null);
  const talkId = body?.talkId;
  if (typeof talkId !== 'string' || !UUID_RE.test(talkId)) {
    throw new BadRequest('"talkId" must be a uuid.');
  }

  // RLS scopes this to the caller, so "not yours" and "does not exist" are the
  // same 404 — no way to probe which talk ids are real.
  const { data: talk, error } = await supabase
    .from('sessions')
    .select('audio_path')
    .eq('id', talkId)
    .maybeSingle();
  if (error) throw error;
  if (!talk?.audio_path) throw new HTTPException(404, { message: 'No such talk.' });

  const { data: audio, error: downloadError } = await supabase.storage
    .from(BUCKET)
    .download(talk.audio_path);
  if (downloadError || !audio) {
    console.error('transcribe: could not download audio', talk.audio_path, downloadError);
    throw new HTTPException(502, { message: 'Could not read the recording.' });
  }

  const filename = talk.audio_path.split('/').pop() ?? 'audio.wav';
  const form = new FormData();
  form.append('model_id', SCRIBE_MODEL);
  form.append('timestamps_granularity', 'word');
  form.append('file', audio, filename);

  // Content-Type is set by fetch (with the multipart boundary); only the key here.
  const response = await fetch(ELEVENLABS_STT_URL, {
    method: 'POST',
    headers: { 'xi-api-key': apiKey },
    body: form,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    console.error('transcribe: ElevenLabs error', response.status, detail);
    throw new HTTPException(502, { message: 'Transcription failed. Try again.' });
  }

  const result = (await response.json()) as ScribeResponse;

  // Keep only spoken words (drop "spacing"/"audio_event" markers) with real
  // timings, so the app can compute pauses from the gaps between them.
  const words: TimedWord[] = (result.words ?? [])
    .filter(
      (w): w is Required<Pick<TimedWord, 'text' | 'start' | 'end'>> =>
        (w.type === undefined || w.type === 'word') &&
        typeof w.text === 'string' &&
        typeof w.start === 'number' &&
        typeof w.end === 'number',
    )
    .map((w) => ({ text: w.text, start: w.start, end: w.end }));

  return c.json({ text: result.text ?? '', words });
});

app.onError((err, c) => {
  if (err instanceof BadRequest) {
    return c.json({ code: 'BAD_REQUEST', message: err.message }, 400);
  }

  if (err instanceof HTTPException) {
    if (err.cause instanceof AuthError) {
      return c.json(err.cause.toJSON(), err.cause.status as 401 | 500);
    }
    return c.json({ code: 'ERROR', message: err.message }, err.status);
  }

  console.error('transcribe:', err);
  return c.json({ code: 'INTERNAL_ERROR', message: 'Something went wrong.' }, 500);
});

export default { fetch: app.fetch };
