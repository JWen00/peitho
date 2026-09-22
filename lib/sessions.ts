import * as Crypto from 'expo-crypto';
import { File } from 'expo-file-system';

import { supabase } from './supabase';
import { localDateString, type Topic } from './topics';

export interface SaveSessionInput {
  topic: Topic;
  /** Local file URI of the clip, from `VoiceRecorder`'s `onComplete`. */
  uri: string;
  durationSeconds: number;
  /** Filled in once on-device transcription lands; null until then. */
  transcript?: string | null;
  /**
   * Idempotency key for this take. Mint it with `newTalkId` when the recording
   * lands and reuse it for every save attempt — see that function.
   */
  clientTalkId: string;
}

export interface SavedSession {
  id: string;
  attemptNumber: number;
  localDate: string;
}

/**
 * Identifies one take for the lifetime of its save, however many attempts that
 * takes.
 *
 * A save that times out mid-upload may well have succeeded on the server, so
 * retrying it blind would store the same minute twice. Resending the same key
 * lets the server recognise the retry and hand back the original talk. Mint it
 * once, when the recording finishes — minting inside `saveSession` would give
 * every retry a fresh key and defeat the whole mechanism.
 */
export function newTalkId(): string {
  return Crypto.randomUUID();
}

/** Pulls the API's error message out of a non-2xx response from the function. */
async function messageFor(error: unknown): Promise<string> {
  const context = (error as { context?: Response }).context;
  if (context && typeof context.json === 'function') {
    try {
      const body = await context.json();
      if (typeof body?.message === 'string') return body.message;
    } catch {
      // Not JSON, or already consumed. Fall through to the generic message.
    }
  }
  return error instanceof Error ? error.message : 'Something went wrong talking to the server.';
}

/**
 * Persists one recording attempt via the `talks` API.
 *
 * The upload, the `sessions` row and the attempt numbering all happen server
 * side in one request, so there is no longer a half-saved state to compensate
 * for here: either the call succeeds and the talk exists complete, or it fails
 * and nothing was written.
 */
export async function saveSession({
  topic,
  uri,
  durationSeconds,
  transcript = null,
  clientTalkId,
}: SaveSessionInput): Promise<SavedSession> {
  const file = new File(uri);
  if (!file.exists) throw new Error('That recording is no longer on this device.');

  const form = new FormData();
  // `File` implements `Blob`, so the clip goes into the request body directly
  // rather than being read into memory first. If the platform's FormData drops
  // the filename, the server falls back to m4a — which is what these are.
  form.append('audio', file as unknown as Blob);
  form.append('clientTalkId', clientTalkId);
  form.append('topicText', topic.text);
  form.append('localDate', localDateString());
  form.append('durationSeconds', String(durationSeconds));
  if (transcript) form.append('transcript', transcript);

  const { data, error } = await supabase.functions.invoke<SavedSession>('talks', {
    body: form,
  });
  if (error) throw new Error(await messageFor(error));
  if (!data) throw new Error('The server saved that recording but returned nothing.');

  // The clip is durable server-side now. Dropping the local copy keeps the
  // document directory from growing by a clip a day forever; failing to delete
  // it is not worth failing the save over.
  try {
    file.delete();
  } catch {
    // Ignore — worst case is a stale file we clean up later.
  }

  return data;
}

export interface TalkSummary {
  id: string;
  topicText: string;
  durationSeconds: number | null;
  attemptNumber: number;
  localDate: string;
  createdAt: string;
}

export interface TalkPage {
  talks: TalkSummary[];
  /** Pass back as `cursor` for the next page; null when this is the last. */
  nextCursor: string | null;
}

/**
 * One page of past talks, newest first.
 *
 * Deliberately no transcripts or audio URLs — the list endpoint omits both so
 * a screenful of rows does not drag a screenful of transcripts behind it.
 */
export async function listTalks(cursor?: string | null): Promise<TalkPage> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  const { data, error } = await supabase.functions.invoke<TalkPage>(`talks${query}`, {
    method: 'GET',
  });
  if (error) throw new Error(await messageFor(error));
  return data ?? { talks: [], nextCursor: null };
}

export interface TalkDetail extends TalkSummary {
  transcript: string | null;
  /** Signed, and short-lived — refetch the talk rather than caching this. */
  audioUrl: string | null;
  audioExpiresAt: string | null;
}

/** One saved talk, with its transcript and a signed URL for playback. */
export async function getTalk(talkId: string): Promise<TalkDetail> {
  const { data, error } = await supabase.functions.invoke<TalkDetail>(`talks/${talkId}`, {
    method: 'GET',
  });
  if (error) throw new Error(await messageFor(error));
  if (!data) throw new Error('That talk could not be loaded.');
  return data;
}

/**
 * Permanently removes a talk and its audio. There is no undo, so callers are
 * expected to confirm first.
 */
export async function deleteTalk(talkId: string): Promise<void> {
  const { error } = await supabase.functions.invoke(`talks/${talkId}`, {
    method: 'DELETE',
  });
  if (error) throw new Error(await messageFor(error));
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
