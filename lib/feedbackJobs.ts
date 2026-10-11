import { useSyncExternalStore } from 'react';

import {
  scoreTalk,
  type FeedbackProgress,
  type PartialFeedback,
  type TalkFeedback,
} from './feedback';
import { saveTalkFeedback } from './sessions';
import type { FeedbackModel, TranscriptionSource } from './settings';

/**
 * Feedback runs, kept outside any component.
 *
 * Scoring can take minutes on-device, and the user will wander off meanwhile. A
 * run owned by the talk screen would be orphaned (or restarted) every time they
 * left it. Here a run belongs to its talk id for the life of the JS process: it
 * keeps going after the screen unmounts, saves its result to the talk itself,
 * and whichever screen next shows that talk picks it up mid-flight. Closing the
 * app ends it — there is no native background task behind this.
 */
export type FeedbackJob =
  /** Waiting for another talk's run: the one on-device model runs one at a time. */
  | { status: 'queued' }
  | { status: 'running'; startedAt: number; progress: FeedbackProgress | null }
  | { status: 'ready'; feedback: TalkFeedback }
  /** Some skills scored, some did not; `Continue` resumes from `partial`. */
  | { status: 'partial'; partial: PartialFeedback }
  | { status: 'unavailable' }
  | { status: 'error'; message: string };

export interface FeedbackJobInput {
  talkId: string;
  topic: string;
  transcript: string;
  durationSeconds: number | null;
  source: TranscriptionSource;
  model: FeedbackModel;
  /** Skills kept from an earlier, unfinished run; only the rest are scored. */
  resume?: PartialFeedback['skills'];
}

const jobs = new Map<string, FeedbackJob>();
const listeners = new Set<() => void>();

/** A run that has ended, for the app-wide "feedback is ready" banner. */
export interface FeedbackFinished {
  talkId: string;
  topic: string;
  outcome: 'ready' | 'partial' | 'error';
}

const finishedListeners = new Set<(event: FeedbackFinished) => void>();

/** Called once per run that ends with a result or an error (not "unavailable"). */
export function onFeedbackFinished(listener: (event: FeedbackFinished) => void) {
  finishedListeners.add(listener);
  return () => {
    finishedListeners.delete(listener);
  };
}

function finished(event: FeedbackFinished) {
  for (const listener of finishedListeners) listener(event);
}

/** Runs chain off this so they never overlap — concurrent generations fail BUSY. */
let queue: Promise<void> = Promise.resolve();

function set(talkId: string, job: FeedbackJob) {
  // A new object per change, so useSyncExternalStore sees a new snapshot.
  jobs.set(talkId, job);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function isActive(job: FeedbackJob | undefined): boolean {
  return job?.status === 'queued' || job?.status === 'running';
}

/**
 * Starts scoring a talk, unless it is already queued or running — so a second
 * tap, or a tap after coming back to the screen, joins the run in flight rather
 * than starting another.
 */
export function startFeedback(input: FeedbackJobInput): void {
  if (isActive(jobs.get(input.talkId))) return;
  set(input.talkId, { status: 'queued' });

  queue = queue.then(async () => {
    const startedAt = Date.now();
    set(input.talkId, { status: 'running', startedAt, progress: null });

    // Skills are saved as they finish, so closing the app mid-run keeps what is
    // done. Saves are chained: concurrent PUTs could land out of order and leave
    // an older, smaller result on the talk.
    let saving: Promise<void> = Promise.resolve();
    const save = (feedback: TalkFeedback | PartialFeedback, what: string) => {
      saving = saving.then(() =>
        saveTalkFeedback(input.talkId, feedback).catch((error: unknown) =>
          console.warn(`[feedback] could not save ${what} to talk:`, error),
        ),
      );
      return saving;
    };
    let savedCount = Object.keys(input.resume ?? {}).length;

    // scoreTalk is documented not to throw; the catch keeps the queue alive if
    // it ever does, since every later run chains off this one.
    const result = await scoreTalk({
      ...input,
      onProgress: (progress) => {
        set(input.talkId, { status: 'running', startedAt, progress });
        if (
          progress.phase === 'scoring' &&
          Object.keys(progress.notes).length > savedCount
        ) {
          savedCount = Object.keys(progress.notes).length;
          void save({ partial: true, skills: progress.notes }, 'progress');
        }
      },
    }).catch(() => ({
      status: 'error' as const,
      message: 'Could not generate feedback.',
    }));

    if (result.status === 'partial') {
      set(input.talkId, result);
      await save(result.partial, 'partial result');
      finished({ talkId: input.talkId, topic: input.topic, outcome: 'partial' });
      return;
    }

    if (result.status !== 'ok') {
      set(input.talkId, result);
      if (result.status === 'error') {
        finished({ talkId: input.talkId, topic: input.topic, outcome: 'error' });
      }
      return;
    }

    set(input.talkId, { status: 'ready', feedback: result.feedback });
    console.log(`[feedback] finished in ${Math.round((Date.now() - startedAt) / 1000)}s`);
    // Saved here, not by the screen, so it lands even if nobody is watching.
    // Best-effort: the result is already in memory for this session, and a
    // failed save only means scoring again after the app restarts.
    await save(result.feedback, 'result');
    // After the save, so tapping through reloads the talk with its feedback on it.
    finished({ talkId: input.talkId, topic: input.topic, outcome: 'ready' });
  });
}

/** The current run (or finished result this session) for a talk, if any. */
export function useFeedbackJob(talkId: string): FeedbackJob | undefined {
  return useSyncExternalStore(subscribe, () => jobs.get(talkId));
}
