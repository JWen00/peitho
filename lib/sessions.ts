import { File } from 'expo-file-system';

import { supabase } from './supabase';
import { localDateString, type Topic } from './topics';

const BUCKET = 'recordings';

/** Falls back to m4a, which is what `RecordingPresets.HIGH_QUALITY` produces. */
function extensionFor(uri: string): string {
  const match = /\.([a-z0-9]+)(?:\?|#|$)/i.exec(uri);
  return match ? match[1].toLowerCase() : 'm4a';
}

function contentTypeFor(extension: string): string {
  if (extension === 'm4a' || extension === 'mp4') return 'audio/mp4';
  if (extension === '3gp') return 'audio/3gpp';
  if (extension === 'webm') return 'audio/webm';
  return 'application/octet-stream';
}

export interface SaveSessionInput {
  topic: Topic;
  /** Local file URI of the clip, from `VoiceRecorder`'s `onComplete`. */
  uri: string;
  durationSeconds: number;
  /** Filled in once on-device transcription lands; null until then. */
  transcript?: string | null;
}

export interface SavedSession {
  id: string;
  audioPath: string;
  attemptNumber: number;
  localDate: string;
}

/**
 * Persists one recording attempt: a `sessions` row plus the audio in Storage.
 *
 * The row is inserted first so Postgres can mint the id, which the storage path
 * is keyed on (`{user_id}/{session_id}.m4a`, per the schema). That costs an
 * extra round trip but avoids shipping a uuid generator to the client. If the
 * upload then fails, the half-written row is removed rather than left behind
 * pointing at nothing.
 */
export async function saveSession({
  topic,
  uri,
  durationSeconds,
  transcript = null,
}: SaveSessionInput): Promise<SavedSession> {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  const user = userData.user;
  if (!user) throw new Error('You need to be signed in to save a recording.');

  const file = new File(uri);
  if (!file.exists) throw new Error('That recording is no longer on this device.');

  // Read before inserting: a missing or unreadable clip should not leave a row.
  const bytes = await file.bytes();

  const localDate = localDateString();

  // Retries on the same topic on the same day are numbered in order. Fine to
  // race-read here: it is one user on one device recording one clip at a time.
  const { count, error: countError } = await supabase
    .from('sessions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('local_date', localDate)
    .eq('topic_text', topic.text);
  if (countError) throw countError;

  const attemptNumber = (count ?? 0) + 1;

  const { data: inserted, error: insertError } = await supabase
    .from('sessions')
    .insert({
      user_id: user.id,
      // `topics.id` is a uuid; the on-device pool uses slugs, so leave the FK
      // null and lean on the `topic_text` snapshot.
      topic_id: null,
      topic_text: topic.text,
      transcript,
      duration_seconds: durationSeconds,
      attempt_number: attemptNumber,
      local_date: localDate,
    })
    .select('id')
    .single();
  if (insertError) throw insertError;

  const extension = extensionFor(uri);
  const audioPath = `${user.id}/${inserted.id}.${extension}`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(audioPath, bytes, { contentType: contentTypeFor(extension), upsert: true });

  if (uploadError) {
    await supabase.from('sessions').delete().eq('id', inserted.id);
    throw uploadError;
  }

  const { error: updateError } = await supabase
    .from('sessions')
    .update({ audio_path: audioPath })
    .eq('id', inserted.id);

  if (updateError) {
    await supabase.storage.from(BUCKET).remove([audioPath]);
    await supabase.from('sessions').delete().eq('id', inserted.id);
    throw updateError;
  }

  // The clip is durable server-side now. Dropping the local copy keeps the
  // document directory from growing by a clip a day forever; failing to delete
  // it is not worth failing the save over.
  try {
    file.delete();
  } catch {
    // Ignore — worst case is a stale file we clean up later.
  }

  return { id: inserted.id, audioPath, attemptNumber, localDate };
}

/**
 * Throws away a take the user listened to and decided against.
 *
 * `VoiceRecorder` writes to the document directory, which the OS never reclaims
 * on its own, so a rejected clip would otherwise sit on the device forever.
 * Failing to delete is not worth surfacing — the file is already orphaned.
 */
export function discardRecording(uri: string): void {
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // Ignore — worst case is a stale file we clean up later.
  }
}
