import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import FeedbackView from '@/components/FeedbackView';
import {
  isPartial,
  missingSkills,
  SKILLS,
  type FeedbackProgress,
  type PartialFeedback,
  type TalkFeedback as Feedback,
} from '@/lib/feedback';
import { startFeedback, useFeedbackJob, type FeedbackJob } from '@/lib/feedbackJobs';
import { useSettings } from '@/lib/settings';

const BRAND = '#aa88f1';

interface TalkFeedbackProps {
  talkId: string;
  topic: string;
  transcript: string;
  durationSeconds: number | null;
  /** Feedback saved with the talk earlier; shown directly, without re-scoring. */
  savedFeedback?: Feedback | PartialFeedback | null;
}

/**
 * On-device coaching for one saved talk: tap to score the transcript, then
 * render the result through {@link FeedbackView}. Degrades to a gentle note on
 * devices/builds without the model.
 *
 * A run that scored only some skills is saved as a partial result; this shows
 * what finished and offers to continue with just the rest.
 *
 * The run itself lives in `lib/feedbackJobs`, not here, so leaving the screen
 * does not stop it: coming back shows the run still in progress (and no second
 * "Get feedback"), and the finished result is saved with the talk either way.
 */
export default function TalkFeedback({
  talkId,
  topic,
  transcript,
  durationSeconds,
  savedFeedback,
}: TalkFeedbackProps) {
  const { transcriptionSource, feedbackModel } = useSettings();
  const job = useFeedbackJob(talkId);

  const run = useCallback(
    (resume?: PartialFeedback['skills']) => {
      startFeedback({
        talkId,
        topic,
        transcript,
        durationSeconds,
        source: transcriptionSource,
        model: feedbackModel,
        resume,
      });
    },
    [talkId, topic, transcript, durationSeconds, transcriptionSource, feedbackModel],
  );

  if (job?.status === 'queued' || job?.status === 'running') {
    return (
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Feedback</Text>
        <FeedbackProgressCard job={job} />
      </View>
    );
  }

  if (job?.status === 'unavailable') {
    return (
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Feedback</Text>
        <Text style={styles.note}>
          On-device coaching isn&apos;t available on this device (it can&apos;t run the
          feedback model, or the build is missing it). Your talk is still saved.
        </Text>
      </View>
    );
  }

  // The newest result wins: a run from this session over what the talk loaded with.
  const current =
    job?.status === 'ready'
      ? job.feedback
      : job?.status === 'partial'
        ? job.partial
        : savedFeedback;

  if (current && !isPartial(current)) {
    return <FeedbackView feedback={current} />;
  }

  const partial = current ?? null;
  const left = partial ? missingSkills(partial).length : 0;

  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>Feedback</Text>

      {job?.status === 'error' ? <Text style={styles.error}>{job.message}</Text> : null}
      {partial ? <PartialSummary partial={partial} /> : null}

      <Pressable
        style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
        onPress={() => run(partial?.skills)}
        accessibilityRole="button"
        accessibilityLabel={
          partial
            ? 'Continue scoring the remaining skills'
            : 'Get coaching feedback on this talk'
        }
      >
        <Text style={styles.buttonText}>
          {partial
            ? `Continue (${left} ${left === 1 ? 'skill' : 'skills'} left)`
            : job?.status === 'error'
              ? 'Try again'
              : 'Get feedback'}
        </Text>
      </Pressable>
    </View>
  );
}

/** What a partial run managed: scores for finished skills, "not scored" for the rest. */
function PartialSummary({ partial }: { partial: PartialFeedback }) {
  const left = missingSkills(partial).length;
  return (
    <View style={styles.partial}>
      <Text style={styles.partialTitle}>
        {SKILLS.length - left} of {SKILLS.length} skills scored
      </Text>
      <Text style={styles.note}>
        {left === 1 ? 'One skill' : `${left} skills`} didn&apos;t finish. Your finished
        scores are saved — continue to score just the rest.
      </Text>
      <View style={styles.partialRows}>
        {SKILLS.map((skill) => {
          const note = partial.skills[skill.key];
          return (
            <View key={skill.key} style={styles.partialRow}>
              <Text style={styles.partialSkill}>{skill.label}</Text>
              <Text style={note ? styles.partialScore : styles.partialMissing}>
                {note ? `${note.score}/5` : 'not scored'}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

/** Headline for the current phase. */
function describe(job: Extract<FeedbackJob, { status: 'queued' | 'running' }>): string {
  if (job.status === 'queued') return 'Waiting for another talk to finish…';
  const progress = job.progress;
  if (!progress) return 'Getting ready…';
  switch (progress.phase) {
    case 'downloading':
      return `Downloading the coach… ${Math.round(progress.progress * 100)}%`;
    case 'preparing':
      return 'Warming up the coach…';
    case 'transcribing':
      return 'Listening back to your talk…';
    case 'scoring':
      return `Scoring ${progress.labels[progress.step]}…`;
  }
}

/**
 * 0..1 across the whole run. Setup gets a small fixed slice so the bar moves
 * before the first prompt; scoring fills the rest one prompt at a time. The
 * one-off model download has its own percentage in the headline instead.
 */
function fractionOf(progress: FeedbackProgress | null): number {
  if (!progress) return 0;
  switch (progress.phase) {
    case 'downloading':
      return progress.progress * 0.05;
    case 'preparing':
      return 0.05;
    case 'transcribing':
      return 0.1;
    case 'scoring':
      return 0.15 + 0.85 * (progress.completed.length / progress.labels.length);
  }
}

function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${`${seconds % 60}`.padStart(2, '0')}`;
}

/** Ticks once a second while mounted, so the elapsed time visibly moves. */
function useNow(): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function FeedbackProgressCard({
  job,
}: {
  job: Extract<FeedbackJob, { status: 'queued' | 'running' }>;
}) {
  const now = useNow();
  const progress = job.status === 'running' ? job.progress : null;
  const fraction = fractionOf(progress);
  const scoring = progress?.phase === 'scoring' ? progress : null;

  return (
    <View
      style={styles.card}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={describe(job)}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(fraction * 100) }}
    >
      <View style={styles.cardHeader}>
        <ActivityIndicator color={BRAND} />
        <Text style={styles.cardTitle}>{describe(job)}</Text>
        {job.status === 'running' ? (
          <Text style={styles.elapsed}>{formatElapsed(now - job.startedAt)}</Text>
        ) : null}
      </View>

      <View style={styles.track}>
        <View style={[styles.fill, { width: `${Math.max(fraction, 0.02) * 100}%` }]} />
      </View>

      {scoring ? (
        <View style={styles.steps}>
          {scoring.labels.map((label, index) => {
            const done = scoring.completed.includes(label);
            const current = index === scoring.step;
            return (
              <View
                key={label}
                style={[
                  styles.step,
                  done && styles.stepDone,
                  current && styles.stepCurrent,
                ]}
              >
                <Text
                  style={[
                    styles.stepText,
                    done && styles.stepTextDone,
                    current && styles.stepTextCurrent,
                  ]}
                >
                  {done ? `✓ ${label}` : label}
                </Text>
              </View>
            );
          })}
        </View>
      ) : null}

      <Text style={styles.hint}>
        This can take a few minutes. Feel free to leave this screen — your feedback will
        keep going and be saved to this talk. Closing the app stops it.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: 40, borderTopWidth: 1, borderTopColor: '#eee', paddingTop: 24 },
  sectionLabel: {
    fontSize: 13,
    color: '#888',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 14,
  },
  note: { fontSize: 15, color: '#888', lineHeight: 21 },
  error: { fontSize: 15, color: '#c0392b', lineHeight: 21, marginBottom: 14 },
  button: {
    backgroundColor: BRAND,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPressed: { opacity: 0.7 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  card: {
    borderRadius: 12,
    backgroundColor: '#f7f3fe',
    padding: 16,
    gap: 14,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cardTitle: { flex: 1, fontSize: 16, fontWeight: '600', color: '#333' },
  elapsed: { fontSize: 14, color: '#888', fontVariant: ['tabular-nums'] },
  track: { height: 6, borderRadius: 3, backgroundColor: '#e6dcfb', overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 3, backgroundColor: BRAND },
  steps: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  step: {
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: 10,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e6dcfb',
  },
  stepDone: { backgroundColor: '#e6dcfb', borderColor: '#e6dcfb' },
  stepCurrent: { borderColor: BRAND },
  stepText: { fontSize: 13, color: '#aaa' },
  stepTextDone: { color: '#6b4fc0' },
  stepTextCurrent: { color: '#333', fontWeight: '600' },
  hint: { fontSize: 13, color: '#888', lineHeight: 18 },
  partial: {
    backgroundColor: '#f7f3fe',
    borderRadius: 12,
    padding: 16,
    gap: 8,
    marginBottom: 14,
  },
  partialTitle: { fontSize: 16, fontWeight: '600', color: '#333' },
  partialRows: { marginTop: 6, gap: 6 },
  partialRow: { flexDirection: 'row', justifyContent: 'space-between' },
  partialSkill: { fontSize: 15, color: '#333' },
  partialScore: { fontSize: 15, fontWeight: '600', color: '#6b4fc0' },
  partialMissing: { fontSize: 15, color: '#c0392b' },
});
