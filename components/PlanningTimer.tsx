import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

/** The plan's think-time before the mic opens. */
export const PLANNING_SECONDS = 120;

function formatClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.ceil(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${`${seconds}`.padStart(2, '0')}`;
}

interface PlanningTimerProps {
  /**
   * Fires when the planning countdown reaches zero. The screen swaps in the
   * recorder, whose own "Start recording" button is what appears once the timer
   * is up — this component never records, it only buys the speaker time to
   * think.
   */
  onReady: () => void;
  /** Overridable mainly so tests do not have to wait two real minutes. */
  seconds?: number;
}

/**
 * The plan step of the core loop: hold the topic on screen with a countdown so
 * the speaker can gather their thoughts, then hand off to the recorder.
 *
 * The countdown does not run on its own — the speaker taps "Start planning" when
 * they are ready to begin, so opening the tab never quietly burns their think
 * time. When it reaches zero {@link PlanningTimerProps.onReady} fires and the
 * screen reveals the recorder.
 *
 * Deliberately knows nothing about the topic or the recorder — the screen owns
 * both and decides what "ready" leads to.
 */
export default function PlanningTimer({
  onReady,
  seconds = PLANNING_SECONDS,
}: PlanningTimerProps) {
  const [started, setStarted] = useState(false);
  const [remaining, setRemaining] = useState(seconds);

  // Held in a ref so the interval fires `onReady` exactly once even if the
  // parent hands us a fresh callback identity between renders.
  const onReadyRef = useRef(onReady);
  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  useEffect(() => {
    if (!started) return;
    const startedAt = Date.now();
    const timer = setInterval(() => {
      const left = seconds - Math.floor((Date.now() - startedAt) / 1000);
      if (left <= 0) {
        clearInterval(timer);
        setRemaining(0);
        onReadyRef.current();
        return;
      }
      setRemaining(left);
    }, 250);
    return () => clearInterval(timer);
  }, [started, seconds]);

  if (!started) {
    return (
      <View style={styles.container}>
        <Text style={styles.hint}>Plan your answer, then record for up to a minute.</Text>
        <TouchableOpacity style={styles.button} onPress={() => setStarted(true)}>
          <Text style={styles.buttonText}>Start planning ({formatClock(seconds)})</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.label}>Planning time</Text>
      <Text style={styles.clock}>{formatClock(remaining)}</Text>
      <Text style={styles.hint}>Take a moment to plan your answer.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', gap: 12 },
  label: {
    fontSize: 13,
    color: '#888',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  clock: {
    fontSize: 44,
    fontWeight: '300',
    fontVariant: ['tabular-nums'],
    color: '#333',
  },
  hint: { fontSize: 15, color: '#888' },
  button: {
    backgroundColor: '#333',
    borderRadius: 14,
    paddingVertical: 18,
    paddingHorizontal: 40,
    marginTop: 8,
  },
  buttonText: { color: '#fff', fontSize: 17, fontWeight: '600' },
});
