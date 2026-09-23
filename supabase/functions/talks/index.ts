/**
 * The talks API.
 *
 *   POST   /talks            save one recording (audio + metadata) atomically
 *   GET    /talks            paginated history, newest first
 *   GET    /talks/:talkId    one talk, with a signed playback URL
 *   DELETE /talks/:talkId    remove a talk and its audio
 *
 * One function rather than three: Supabase gives each function its own URL and
 * its own cold start, and these three share all of their auth, CORS and
 * serialisation. The heatmap is deliberately not here — it is a `talk_heatmap`
 * RPC, because an aggregate over a year of days pages differently from a list.
 *
 * Every route is `auth: 'user'`, so `verify_jwt` stays at its default and
 * `ctx.supabase` is already scoped to the caller by RLS. No route takes a user
 * id: the JWT is the only thing that decides whose talks these are.
 */
import { Hono } from 'npm:hono@^4.6.0';
import { cors } from 'npm:hono@^4.6.0/cors';
import { HTTPException } from 'npm:hono@^4.6.0/http-exception';
import { withSupabase } from 'npm:@supabase/server@^1.7.0/adapters/hono';
import { AuthError } from 'npm:@supabase/server@^1.7.0';

import type { Database } from '../../../lib/database.types.ts';

const BUCKET = 'recordings';

/**
 * A 1-minute 16kHz 16-bit mono wav — what the recognizer persists while it
 * transcribes — is ~2MB. This is slack, not a real expectation.
 */
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

/**
 * The 1:00 cutoff is the client's job. The server only rejects durations that
 * cannot describe a real recording, so timer slop never costs someone a save.
 */
const MAX_DURATION_SECONDS = 90;

const MAX_TOPIC_LENGTH = 500;

/** Long enough to start playback, short enough that a leaked URL goes stale. */
const SIGNED_URL_TTL_SECONDS = 60 * 60;

/**
 * Storage signs URLs against `SUPABASE_URL`, which inside the local stack is
 * `http://kong:8000` — an address the function can reach and a phone cannot.
 * Either variable names the externally reachable origin instead.
 *
 * Two of them because the CLI refuses to load any `--env-file` key starting
 * with `SUPABASE_` ("Env name cannot start with SUPABASE_, skipping"), so a
 * local override has to use an unreserved name. In production `SUPABASE_URL`
 * is already public and neither is set, leaving this a no-op.
 */
const PUBLIC_ORIGIN = Deno.env.get('PUBLIC_API_URL') ??
  Deno.env.get('SUPABASE_PUBLIC_URL') ?? null;

function toPublicUrl(signedUrl: string): string {
  if (!PUBLIC_ORIGIN) return signedUrl;
  const url = new URL(signedUrl);
  const { protocol, host } = new URL(PUBLIC_ORIGIN);
  url.protocol = protocol;
  url.host = host;
  return url.toString();
}

const DEFAULT_PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 100;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Columns a list item needs. Transcript and audio are detail-only. */
const LIST_COLUMNS =
  'id, topic_text, duration_seconds, attempt_number, local_date, created_at';
const DETAIL_COLUMNS = `${LIST_COLUMNS}, transcript, audio_path`;

type SessionRow = Database['public']['Tables']['sessions']['Row'];

/** Exactly what `LIST_COLUMNS` selects. A detail row is structurally wider. */
type TalkListRow = Pick<
  SessionRow,
  'id' | 'topic_text' | 'duration_seconds' | 'attempt_number' | 'local_date' | 'created_at'
>;

const app = new Hono().basePath('/talks');

app.use('*', cors());
app.use('*', withSupabase<Database>({ auth: 'user' }));

// Serialisation -------------------------------------------------------------

/** snake_case is the database's business; the API boundary speaks camelCase. */
function toListItem(row: TalkListRow) {
  return {
    id: row.id,
    topicText: row.topic_text,
    durationSeconds: row.duration_seconds,
    attemptNumber: row.attempt_number,
    localDate: row.local_date,
    createdAt: row.created_at,
  };
}

// Validation ----------------------------------------------------------------

class BadRequest extends Error {}

function fail(message: string): never {
  throw new BadRequest(message);
}

function requireString(form: FormData, field: string, maxLength: number): string {
  const value = form.get(field);
  if (typeof value !== 'string' || value.trim() === '') {
    fail(`"${field}" is required.`);
  }
  if (value.length > maxLength) {
    fail(`"${field}" must be at most ${maxLength} characters.`);
  }
  return value;
}

function requireUuid(form: FormData, field: string): string {
  const value = form.get(field);
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    fail(`"${field}" must be a uuid.`);
  }
  return value.toLowerCase();
}

function optionalUuid(form: FormData, field: string): string | null {
  const value = form.get(field);
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    fail(`"${field}" must be a uuid.`);
  }
  return value.toLowerCase();
}

/**
 * `local_date` is computed on the device on purpose — it is what makes the
 * heatmap reflect the user's day rather than UTC. That trust has a limit: a
 * device with a badly wrong clock would otherwise scatter rows across the
 * calendar, so anything further than a day from UTC is rejected.
 */
function requireLocalDate(form: FormData): string {
  const value = form.get('localDate');
  if (typeof value !== 'string' || !DATE_RE.test(value)) {
    fail('"localDate" must be a YYYY-MM-DD date.');
  }

  const parsed = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed)) fail('"localDate" is not a real date.');

  const dayMs = 24 * 60 * 60 * 1000;
  const todayUtc = Math.floor(Date.now() / dayMs) * dayMs;
  if (Math.abs(parsed - todayUtc) > dayMs) {
    fail('"localDate" is too far from the current date.');
  }

  return value;
}

function requireDuration(form: FormData): number {
  const raw = form.get('durationSeconds');
  const value = Number(raw);
  if (typeof raw !== 'string' || !Number.isInteger(value)) {
    fail('"durationSeconds" must be a whole number of seconds.');
  }
  if (value < 1 || value > MAX_DURATION_SECONDS) {
    fail(`"durationSeconds" must be between 1 and ${MAX_DURATION_SECONDS}.`);
  }
  return value;
}

function requireAudio(form: FormData): File {
  const value = form.get('audio');
  if (!(value instanceof File)) fail('"audio" must be a file.');
  if (value.size === 0) fail('"audio" is empty.');
  if (value.size > MAX_AUDIO_BYTES) {
    throw new HTTPException(413, {
      message: `Audio must be at most ${MAX_AUDIO_BYTES} bytes.`,
    });
  }
  return value;
}

/** Falls back to wav, which is what the client's persisted clips are. */
function extensionFor(file: File): string {
  const match = /\.([a-z0-9]+)$/i.exec(file.name ?? '');
  return match ? match[1].toLowerCase() : 'wav';
}

function contentTypeFor(extension: string): string {
  if (extension === 'wav') return 'audio/wav';
  // iOS writes Core Audio Format unless the recording is pinned to PCM wav.
  if (extension === 'caf') return 'audio/x-caf';
  if (extension === 'm4a' || extension === 'mp4') return 'audio/mp4';
  if (extension === '3gp') return 'audio/3gpp';
  if (extension === 'webm') return 'audio/webm';
  return 'application/octet-stream';
}

// POST /talks ---------------------------------------------------------------

app.post('/', async (c) => {
  const { supabase, userClaims } = c.var.supabaseContext;
  const userId = userClaims!.id;

  const form = await c.req.formData();

  const clientTalkId = requireUuid(form, 'clientTalkId');
  const topicText = requireString(form, 'topicText', MAX_TOPIC_LENGTH);
  const topicId = optionalUuid(form, 'topicId');
  const localDate = requireLocalDate(form);
  const durationSeconds = requireDuration(form);
  const transcriptRaw = form.get('transcript');
  const transcript = typeof transcriptRaw === 'string' && transcriptRaw !== ''
    ? transcriptRaw
    : null;
  const audio = requireAudio(form);

  // Idempotency: a retry after a timed-out upload must return the original
  // talk, not create a second one. Checked here so the common retry costs one
  // query, and enforced by a unique index for the case where two retries race.
  const { data: existing, error: existingError } = await supabase
    .from('sessions')
    .select(LIST_COLUMNS)
    .eq('client_talk_id', clientTalkId)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) return c.json(toListItem(existing), 200);

  // The storage path is keyed on the talk id, so mint it here rather than
  // letting Postgres do it: that makes the upload the *first* write, and a
  // failed upload leaves nothing at all behind. Only the reverse order — row
  // first — needs a compensating delete on every subsequent failure.
  const talkId = crypto.randomUUID();
  const extension = extensionFor(audio);
  const audioPath = `${userId}/${talkId}.${extension}`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(audioPath, await audio.arrayBuffer(), {
      contentType: contentTypeFor(extension),
      upsert: true,
    });
  if (uploadError) throw uploadError;

  // `attempt_number` is set by a trigger, so it is read back rather than sent.
  const { data: inserted, error: insertError } = await supabase
    .from('sessions')
    .insert({
      id: talkId,
      user_id: userId,
      client_talk_id: clientTalkId,
      topic_id: topicId,
      topic_text: topicText,
      transcript,
      audio_path: audioPath,
      duration_seconds: durationSeconds,
      local_date: localDate,
    })
    .select(LIST_COLUMNS)
    .single();

  if (insertError) {
    // Nothing references the object now, so it would be orphaned bytes the
    // user still pays for. Best-effort: the insert error is the real failure.
    await supabase.storage.from(BUCKET).remove([audioPath]).catch(() => {});

    // Two retries of the same recording raced past the check above, or two
    // saves collided on the attempt number. Either way the caller's talk
    // either already exists or is safe to re-send.
    if (insertError.code === '23505') {
      const { data: winner } = await supabase
        .from('sessions')
        .select(LIST_COLUMNS)
        .eq('client_talk_id', clientTalkId)
        .maybeSingle();
      if (winner) return c.json(toListItem(winner), 200);
      throw new HTTPException(409, { message: 'That talk conflicts with an existing one.' });
    }

    throw insertError;
  }

  return c.json(toListItem(inserted), 201);
});

// GET /talks ----------------------------------------------------------------

app.get('/', async (c) => {
  const { supabase } = c.var.supabaseContext;

  const from = c.req.query('from');
  const to = c.req.query('to');
  if (from !== undefined && !DATE_RE.test(from)) fail('"from" must be a YYYY-MM-DD date.');
  if (to !== undefined && !DATE_RE.test(to)) fail('"to" must be a YYYY-MM-DD date.');

  const limitRaw = c.req.query('limit');
  const limit = limitRaw === undefined ? DEFAULT_PAGE_SIZE : Number(limitRaw);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
    fail(`"limit" must be between 1 and ${MAX_PAGE_SIZE}.`);
  }

  // Keyset rather than offset: the list grows at the head, and an offset page
  // shifts under the reader every time a talk is saved. `created_at` alone is
  // enough of a key — it is microsecond-resolution and single-writer per user.
  const cursor = c.req.query('cursor');
  if (cursor !== undefined && Number.isNaN(Date.parse(cursor))) {
    fail('"cursor" must be the createdAt of the last item in the previous page.');
  }

  let query = supabase
    .from('sessions')
    .select(LIST_COLUMNS)
    .order('created_at', { ascending: false })
    // One extra row answers "is there another page?" without a count query.
    .limit(limit + 1);

  if (from) query = query.gte('local_date', from);
  if (to) query = query.lte('local_date', to);
  if (cursor) query = query.lt('created_at', cursor);

  const { data, error } = await query;
  if (error) throw error;

  const hasMore = data.length > limit;
  const page = hasMore ? data.slice(0, limit) : data;

  return c.json({
    talks: page.map(toListItem),
    nextCursor: hasMore ? page[page.length - 1].created_at : null,
  });
});

// GET /talks/:talkId --------------------------------------------------------

app.get('/:talkId', async (c) => {
  const { supabase } = c.var.supabaseContext;

  const talkId = c.req.param('talkId');
  if (!UUID_RE.test(talkId)) fail('"talkId" must be a uuid.');

  const { data: talk, error } = await supabase
    .from('sessions')
    .select(DETAIL_COLUMNS)
    .eq('id', talkId)
    .maybeSingle();
  if (error) throw error;

  // RLS filters someone else's talk down to zero rows, so "not yours" and
  // "does not exist" arrive here identically — and should leave identically,
  // rather than letting a 403 confirm which ids are real.
  if (!talk) throw new HTTPException(404, { message: 'No such talk.' });

  // The bucket is private, so hand back a URL the client can actually play
  // instead of a path it would have to sign in a second round trip.
  let audioUrl: string | null = null;
  let audioExpiresAt: string | null = null;
  if (talk.audio_path) {
    const { data: signed, error: signError } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(talk.audio_path, SIGNED_URL_TTL_SECONDS);
    if (signError) throw signError;
    audioUrl = toPublicUrl(signed.signedUrl);
    audioExpiresAt = new Date(Date.now() + SIGNED_URL_TTL_SECONDS * 1000).toISOString();
  }

  return c.json({
    ...toListItem(talk),
    transcript: talk.transcript,
    audioUrl,
    audioExpiresAt,
  });
});

// DELETE /talks/:talkId -----------------------------------------------------

app.delete('/:talkId', async (c) => {
  const { supabase } = c.var.supabaseContext;

  const talkId = c.req.param('talkId');
  if (!UUID_RE.test(talkId)) fail('"talkId" must be a uuid.');

  // Read the path first: once the row is gone there is nothing left pointing at
  // the object, and it would be orphaned bytes the user still pays to store.
  const { data: talk, error: readError } = await supabase
    .from('sessions')
    .select('id, audio_path')
    .eq('id', talkId)
    .maybeSingle();
  if (readError) throw readError;
  if (!talk) throw new HTTPException(404, { message: 'No such talk.' });

  // Row before object, deliberately. If the object delete then fails the user
  // still sees the talk gone and only some unreferenced bytes remain, which is
  // recoverable. The reverse order can leave a row pointing at missing audio,
  // which shows up as a talk that will not play.
  const { error: deleteError } = await supabase.from('sessions').delete().eq('id', talkId);
  if (deleteError) throw deleteError;

  if (talk.audio_path) {
    const { error: removeError } = await supabase.storage.from(BUCKET).remove([talk.audio_path]);
    // Logged, not surfaced: the talk is gone as far as the caller is concerned,
    // and failing the request now would invite a retry that 404s.
    if (removeError) console.error('talks: orphaned object', talk.audio_path, removeError);
  }

  return c.body(null, 204);
});

// Errors --------------------------------------------------------------------

app.onError((err, c) => {
  if (err instanceof BadRequest) {
    return c.json({ code: 'BAD_REQUEST', message: err.message }, 400);
  }

  if (err instanceof HTTPException) {
    // Auth failures carry the library's own payload, which names the exact
    // credential problem — far more useful to the client than a bare 401.
    if (err.cause instanceof AuthError) {
      return c.json(err.cause.toJSON(), err.cause.status as 401 | 500);
    }
    return c.json({ code: 'ERROR', message: err.message }, err.status);
  }

  // Postgres and Storage errors can name columns, policies and paths. Log them
  // in full; tell the caller only that it was our fault.
  console.error('talks:', err);
  return c.json({ code: 'INTERNAL_ERROR', message: 'Something went wrong.' }, 500);
});

export default { fetch: app.fetch };
