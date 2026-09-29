import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import FeedbackView from '@/components/FeedbackView';
import { scoreTalk, type TalkFeedback as Feedback } from '@/lib/feedback';
import { useSettings } from '@/lib/settings';

const BRAND = '#aa88f1';

type State =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; feedback: Feedback }
  | { status: 'unavailable' }
  | { status: 'error'; message: string };

interface TalkFeedbackProps {
  talkId: string;
  topic: string;
  transcript: string;
  durationSeconds: number | null;
}

/**
 * On-device coaching for one saved talk: tap to score the transcript with the
 * built-in model, then render the result through {@link FeedbackView}. Degrades
 * to a gentle note on devices/builds without the model.
 */
export default function TalkFeedback({
  talkId,
  topic,
  transcript,
  durationSeconds,
}: TalkFeedbackProps) {
  const { transcriptionSource, feedbackModel } = useSettings();
  const [state, setState] = useState<State>({ status: 'idle' });
  // 0..1 while the model file downloads on first use, null otherwise.
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  // Scoring can take several seconds on-device; guard against a second run
  // being kicked off before the first settles.
  const running = useRef(false);

  const run = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setDownloadProgress(null);
    setState({ status: 'loading' });
    try {
      const result = await scoreTalk({
        talkId,
        topic,
        transcript,
        durationSeconds,
        source: transcriptionSource,
        model: feedbackModel,
        onDownloadProgress: setDownloadProgress,
      });
      if (result.status === 'ok')
        setState({ status: 'ready', feedback: result.feedback });
      else if (result.status === 'unavailable') setState({ status: 'unavailable' });
      else setState({ status: 'error', message: result.message });
    } finally {
      running.current = false;
      setDownloadProgress(null);
    }
  }, [talkId, topic, transcript, durationSeconds, transcriptionSource, feedbackModel]);

  if (state.status === 'ready') {
    return <FeedbackView feedback={state.feedback} />;
  }

  if (state.status === 'unavailable') {
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

  const loading = state.status === 'loading';

  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>Feedback</Text>

      {state.status === 'error' ? (
        <Text style={styles.error}>{state.message}</Text>
      ) : null}

      <Pressable
        style={({ pressed }) => [
          styles.button,
          (pressed || loading) && styles.buttonBusy,
        ]}
        onPress={run}
        disabled={loading}
        accessibilityRole="button"
        accessibilityState={{ disabled: loading, busy: loading }}
        accessibilityLabel="Get coaching feedback on this talk"
      >
        {loading ? (
          <View style={styles.busyRow}>
            <ActivityIndicator color="#fff" />
            <Text style={styles.buttonText}>
              {downloadProgress != null && downloadProgress < 1
                ? `Downloading model… ${Math.round(downloadProgress * 100)}%`
                : 'Coaching your talk…'}
            </Text>
          </View>
        ) : (
          <Text style={styles.buttonText}>
            {state.status === 'error' ? 'Try again' : 'Get feedback'}
          </Text>
        )}
      </Pressable>
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
  buttonBusy: { opacity: 0.7 },
  busyRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
