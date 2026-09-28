import * as Crypto from 'expo-crypto';
import { File } from 'expo-file-system';

import { supabase } from './supabase';
import { localDateString, type Topic } from './topics';

export interface SaveSessionInput {
  topic: Topic;
  /** Local file URI of the clip, from `VoiceRecorder`'s `onComplete`. */
  uri: string;
  durationSeconds: number;
  /**
   * What the recognizer heard while the take was being recorded. Null when it
   * produced nothing usable — a take without words is still a take.
   */
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
  return error instanceof Error
    ? error.message
    : 'Something went wrong talking to the server.';
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
  // the filename, the server falls back to wav — which is what the recognizer's
  // persisted clips are.
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

export interface ListTalksOptions {
  /** Keyset cursor — the `nextCursor` from the previous page. */
  cursor?: string | null;
  /** How many talks to return. The server caps this at 100; omit for its default. */
  limit?: number;
  /** Inclusive local-date lower bound, YYYY-MM-DD. */
  from?: string;
  /** Inclusive local-date upper bound, YYYY-MM-DD. Pass `from === to` for one day. */
  to?: string;
}

/**
 * One page of past talks, newest first.
 *
 * Deliberately no transcripts or audio URLs — the list endpoint omits both so
 * a screenful of rows does not drag a screenful of transcripts behind it.
 *
 * `limit` trims the page — the History summary asks for just the few most recent
 * talks. `from`/`to` narrow it to a local-date window. All three combine with
 * the cursor, so a trimmed or filtered range still pages the same way.
 */
export async function listTalks(options: ListTalksOptions = {}): Promise<TalkPage> {
  const params = new URLSearchParams();
  if (options.cursor) params.set('cursor', options.cursor);
  if (options.limit !== undefined) params.set('limit', String(options.limit));
  if (options.from) params.set('from', options.from);
  if (options.to) params.set('to', options.to);
  const query = params.toString();
  const { data, error } = await supabase.functions.invoke<TalkPage>(
    `talks${query ? `?${query}` : ''}`,
    { method: 'GET' },
  );
  if (error) throw new Error(await messageFor(error));
  return data ?? { talks: [], nextCursor: null };
}

export interface HeatmapDay {
  /** Local date, YYYY-MM-DD — matches `sessions.local_date`. */
  date: string;
  /** Talks recorded that day; always >= 1. Missing dates are zero. */
  count: number;
}

export interface TalkHeatmap {
  /** Inclusive window the grid covers, echoing the request. */
  from: string;
  to: string;
  /** Only days with at least one talk, ascending by date. */
  days: HeatmapDay[];
}

/**
 * Talk counts per day across a date window, for the calendar heatmap.
 *
 * Deliberately not built from `listTalks`: that returns one row per talk with
 * fields the grid throws away and pages by cursor, whereas the grid wants one
 * count per day across a fixed window. The `talk_heatmap` RPC does the
 * `GROUP BY` in Postgres and is scoped to the caller by RLS, so this is a
 * direct `rpc` call rather than an edge-function hop.
 *
 * The response is sparse — only days with at least one talk. Callers densify by
 * looking each grid cell up with `heatmapIndex`; an absent date is zero.
 */
export async function getTalkHeatmap(from: string, to: string): Promise<TalkHeatmap> {
  const { data, error } = await supabase.rpc('talk_heatmap', {
    from_date: from,
    to_date: to,
  });
  if (error) throw new Error(await messageFor(error));
  return {
    from,
    to,
    days: (data ?? []).map((row) => ({ date: row.talk_date, count: row.talk_count })),
  };
}

/**
 * A `date -> count` lookup so the grid renders each cell in O(1) instead of
 * scanning `days`. Dates absent from the map are zero-talk days.
 */
export function heatmapIndex(heatmap: TalkHeatmap): Map<string, number> {
  return new Map(heatmap.days.map((day) => [day.date, day.count]));
}

export interface TalkStats {
  /** Talks recorded in the window — effectively all-time for a young account. */
  totalTalks: number;
  /**
   * Consecutive local days with at least one talk, counting back from today.
   * Today not yet having a talk does not break it: the streak still runs through
   * yesterday until a day is actually missed.
   */
  currentStreak: number;
}

/** Wide enough that the totals read as all-time rather than "this year". */
const STATS_WINDOW_DAYS = 3660;

/**
 * Headline numbers for the History summary — total talks and current streak.
 *
 * Built from the same `talk_heatmap` aggregate the grid uses rather than a
 * separate count: one RLS-scoped `GROUP BY` already has a count per day, which
 * is all both the total (their sum) and the streak (a walk back from today)
 * need. No extra endpoint, and no per-talk rows pulled down to be counted.
 */
export async function getTalkStats(days = STATS_WINDOW_DAYS): Promise<TalkStats> {
  const to = localDateString();
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - (days - 1));
  const from = localDateString(fromDate);

  const counts = heatmapIndex(await getTalkHeatmap(from, to));

  let totalTalks = 0;
  for (const count of counts.values()) totalTalks += count;

  const cursor = new Date();
  // A day with no talk yet is not a broken streak — start the count at yesterday.
  if ((counts.get(localDateString(cursor)) ?? 0) === 0) {
    cursor.setDate(cursor.getDate() - 1);
  }
  let currentStreak = 0;
  while ((counts.get(localDateString(cursor)) ?? 0) > 0) {
    currentStreak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  return { totalTalks, currentStreak };
}

/** Recent talks scanned to find same-topic attempts; the list API has no topic filter. */
const ATTEMPT_SCAN_LIMIT = 100;

/**
 * Other saved talks on the same topic as `excludeId`, newest first — the raw
 * material for comparing attempts on the detail screen.
 *
 * The list endpoint has no topic filter, so this scans the most recent talks and
 * matches on the snapshotted `topic_text`. At a talk a day that window covers
 * every attempt a user is realistically going to have; a very long history could
 * age the oldest ones out, which a server-side topic filter would later remove.
 */
export async function getTalksByTopic(
  topicText: string,
  excludeId: string,
): Promise<TalkSummary[]> {
  const page = await listTalks({ limit: ATTEMPT_SCAN_LIMIT });
  return page.talks.filter(
    (talk) => talk.id !== excludeId && talk.topicText === topicText,
  );
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
