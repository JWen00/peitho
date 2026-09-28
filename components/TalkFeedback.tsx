import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import FeedbackView from '@/components/FeedbackView';
import { scoreTalk, type TalkFeedback as Feedback } from '@/lib/feedback';

const BRAND = '#aa88f1';

type State =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; feedback: Feedback }
  | { status: 'unavailable' }
  | { status: 'error'; message: string };

interface TalkFeedbackProps {
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
  topic,
  transcript,
  durationSeconds,
}: TalkFeedbackProps) {
  const [state, setState] = useState<State>({ status: 'idle' });

  const run = useCallback(async () => {
    setState({ status: 'loading' });
    const result = await scoreTalk({ topic, transcript, durationSeconds });
    if (result.status === 'ok') setState({ status: 'ready', feedback: result.feedback });
    else if (result.status === 'unavailable') setState({ status: 'unavailable' });
    else setState({ status: 'error', message: result.message });
  }, [topic, transcript, durationSeconds]);

  if (state.status === 'ready') {
    return <FeedbackView feedback={state.feedback} />;
  }

  if (state.status === 'loading') {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={BRAND} />
        <Text style={styles.loadingText}>Coaching your talk…</Text>
      </View>
    );
  }

  if (state.status === 'unavailable') {
    return (
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Feedback</Text>
        <Text style={styles.note}>
          On-device coaching needs iOS 26 with Apple Intelligence, or a supported Android
          device. Your talk is still saved.
        </Text>
      </View>
    );
  }

  if (state.status === 'error') {
    return (
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Feedback</Text>
        <Text style={styles.error}>{state.message}</Text>
        <Pressable
          style={({ pressed }) => [styles.button, pressed && styles.pressed]}
          onPress={run}
          accessibilityRole="button"
        >
          <Text style={styles.buttonText}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.section}>
      <Pressable
        style={({ pressed }) => [styles.button, pressed && styles.pressed]}
        onPress={run}
        accessibilityRole="button"
        accessibilityLabel="Get coaching feedback on this talk"
      >
        <Text style={styles.buttonText}>Get feedback</Text>
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
  centered: { marginTop: 40, paddingTop: 24, alignItems: 'center', gap: 10 },
  loadingText: { fontSize: 14, color: '#888' },
  note: { fontSize: 15, color: '#888', lineHeight: 21 },
  error: { fontSize: 15, color: '#c0392b', marginBottom: 14 },
  button: {
    backgroundColor: BRAND,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
  },
  pressed: { opacity: 0.7 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
