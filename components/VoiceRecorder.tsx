import {
  RecordingPresets,
  getRecordingPermissionsAsync,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import LevelMeter from './LevelMeter';

/** Default speaking window when no limit is supplied; the user can change it in Settings. */
export const MAX_DURATION_SECONDS = 60;
/** How much time is left when the "wrap up" haptic + visual cue fires. */
const WARN_AT_SECONDS_LEFT = 10;
/**
 * Status poll interval. Each poll is one bar of the level meter, so this is
 * really the meter's frame rate — 100ms scrolls smoothly, where the 200ms the
 * countdown alone needed looked stepped.
 */
const POLL_INTERVAL_MS = 100;

/**
 * Module scope on purpose: `useAudioRecorder` re-creates the native recorder
 * whenever the serialized options change, so a fresh object literal each render
 * would churn the recorder.
 *
 * `directory: 'document'` keeps the clip out of the cache directory, which the
 * OS may purge before we have uploaded it to Storage.
 */
const RECORDING_OPTIONS = {
  ...RecordingPresets.HIGH_QUALITY,
  directory: 'document' as const,
  isMeteringEnabled: true,
};

export interface VoiceRecording {
  /** Local file URI of the finished clip. */
  uri: string;
  /** Length of the clip in whole seconds. */
  durationSeconds: number;
}

type Phase = 'idle' | 'preparing' | 'recording' | 'finished' | 'denied' | 'error';

interface VoiceRecorderProps {
  /**
   * Fires when a new take starts. The screen uses this to drop the previous
   * clip, so a stale take can never be reviewed or saved while a fresh one is
   * being recorded.
   */
  onStart?: () => void;
  /** Fires once a clip has been captured and is ready to review. */
  onComplete?: (recording: VoiceRecording) => void;
  /** Fires when a recording was abandoned mid-way (backgrounded, call, error). */
  onInterrupted?: (reason: string) => void;
  /** Overridable mainly so tests do not have to wait a real minute. */
  maxDurationSeconds?: number;
}

function formatClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.ceil(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${`${seconds}`.padStart(2, '0')}`;
}

/**
 * The record step of the core loop: request the mic, capture up to the
 * configured limit, and hand back a local file URI.
 *
 * Deliberately knows nothing about topics, transcription or Supabase — the
 * screen owns those. Its only job is producing a clip.
 */
export default function VoiceRecorder({
  onStart,
  onComplete,
  onInterrupted,
  maxDurationSeconds = MAX_DURATION_SECONDS,
}: VoiceRecorderProps) {
  const recorder = useAudioRecorder(RECORDING_OPTIONS);
  const recorderState = useAudioRecorderState(recorder, POLL_INTERVAL_MS);

  const [phase, setPhase] = useState<Phase>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [lastRecording, setLastRecording] = useState<VoiceRecording | null>(null);

  // Guards the stop path. The cutoff timer, the Stop button and the
  // interruption handler can all race to end the same recording.
  const stoppingRef = useRef(false);
  const cutoffTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warnedRef = useRef(false);

  const elapsedSeconds = recorderState.isRecording ? recorderState.durationMillis / 1000 : 0;
  const remainingSeconds = Math.max(0, maxDurationSeconds - elapsedSeconds);
  const isWrappingUp = phase === 'recording' && remainingSeconds <= WARN_AT_SECONDS_LEFT;

  const clearCutoffTimer = useCallback(() => {
    if (cutoffTimerRef.current !== null) {
      clearTimeout(cutoffTimerRef.current);
      cutoffTimerRef.current = null;
    }
  }, []);

  /**
   * Ends the recording exactly once. `keep: false` throws the clip away, which
   * is what an interruption does — a partial minute is not worth reviewing.
   */
  const finish = useCallback(
    async (keep: boolean, reason?: string) => {
      if (stoppingRef.current) return;
      stoppingRef.current = true;
      clearCutoffTimer();

      const durationSeconds = Math.min(
        maxDurationSeconds,
        Math.round(recorder.getStatus().durationMillis / 1000)
      );

      try {
        await recorder.stop();
      } catch {
        // Already stopped, or the session died under us. Either way the clip
        // below is the source of truth.
      }

      // Returning the session to playback mode matters on iOS: leaving
      // `allowsRecording` on routes later playback to the earpiece.
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});

      const uri = recorder.uri;

      if (!keep || !uri) {
        setLastRecording(null);
        setPhase('idle');
        setMessage(reason ?? 'Recording interrupted. Try again.');
        if (reason) onInterrupted?.(reason);
        stoppingRef.current = false;
        return;
      }

      const recording: VoiceRecording = { uri, durationSeconds };
      setLastRecording(recording);
      setPhase('finished');
      setMessage(null);
      stoppingRef.current = false;
      onComplete?.(recording);
    },
    [clearCutoffTimer, maxDurationSeconds, onComplete, onInterrupted, recorder]
  );

  const start = useCallback(async () => {
    setMessage(null);
    setPhase('preparing');

    let permission = await getRecordingPermissionsAsync();
    if (!permission.granted && permission.canAskAgain) {
      permission = await requestRecordingPermissionsAsync();
    }
    if (!permission.granted) {
      setPhase('denied');
      setMessage(
        permission.canAskAgain
          ? 'Peitho needs the microphone to record your answer.'
          : 'Microphone access is off. Enable it in Settings to record.'
      );
      return;
    }

    try {
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
        interruptionMode: 'doNotMix',
      });

      // Required before every `record()`, not just the first.
      await recorder.prepareToRecordAsync();

      stoppingRef.current = false;
      warnedRef.current = false;
      setLastRecording(null);
      recorder.record();
      setPhase('recording');
      onStart?.();

      // The plan's hard cutoff: a timer stops the recording, never the user.
      clearCutoffTimer();
      cutoffTimerRef.current = setTimeout(() => {
        void finish(true);
      }, maxDurationSeconds * 1000);
    } catch (error) {
      setPhase('error');
      setMessage(error instanceof Error ? error.message : 'Could not start recording.');
    }
  }, [clearCutoffTimer, finish, maxDurationSeconds, onStart, recorder]);

  const stop = useCallback(() => {
    void finish(true);
  }, [finish]);

  // Gentle cue at ten seconds left, once per recording.
  useEffect(() => {
    if (phase !== 'recording' || warnedRef.current) return;
    if (remainingSeconds > WARN_AT_SECONDS_LEFT) return;
    warnedRef.current = true;
    if (Platform.OS !== 'web') {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    }
  }, [phase, remainingSeconds]);

  // Backstop for the cutoff timer: if the JS timer was starved, the polled
  // native duration still ends the recording. Gated on `isRecording` because
  // the polled state can still describe the *previous* clip for up to one
  // interval after "Record again" — without the gate, a full-length first take
  // would instantly cut the second one short.
  useEffect(() => {
    if (phase !== 'recording' || !recorderState.isRecording) return;
    if (recorderState.durationMillis / 1000 < maxDurationSeconds) return;
    void finish(true);
  }, [finish, maxDurationSeconds, phase, recorderState.isRecording, recorderState.durationMillis]);

  // Backgrounding, a call, or the system resetting media services all mean the
  // clip is no longer trustworthy. Stop and discard rather than save a fragment.
  useEffect(() => {
    if (phase !== 'recording') return;

    if (recorderState.mediaServicesDidReset) {
      void finish(false, 'Audio was interrupted by the system. Try again.');
      return;
    }

    const subscription = AppState.addEventListener('change', (next) => {
      if (next !== 'active') {
        void finish(false, 'Recording stopped when you left the app. Try again.');
      }
    });
    return () => subscription.remove();
  }, [finish, phase, recorderState.mediaServicesDidReset]);

  useEffect(() => clearCutoffTimer, [clearCutoffTimer]);

  if (phase === 'preparing') {
    return (
      <View style={styles.container}>
        <ActivityIndicator />
        <Text style={styles.hint}>Getting the mic ready…</Text>
      </View>
    );
  }

  if (phase === 'recording') {
    return (
      <View style={styles.container}>
        <View style={[styles.dot, isWrappingUp && styles.dotWarning]} />
        <Text style={[styles.clock, isWrappingUp && styles.clockWarning]}>
          {formatClock(remainingSeconds)}
        </Text>
        <LevelMeter
          metering={recorderState.metering}
          durationMillis={recorderState.durationMillis}
          active={recorderState.isRecording}
          warning={isWrappingUp}
        />
        <Text style={styles.hint}>{isWrappingUp ? 'Start wrapping up' : 'Recording…'}</Text>
        <TouchableOpacity style={[styles.button, styles.stopButton]} onPress={stop}>
          <Text style={styles.buttonText}>Stop</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (phase === 'finished' && lastRecording) {
    return (
      <View style={styles.container}>
        <Text style={styles.hint}>Listen back, then keep it or try again.</Text>
        <TouchableOpacity style={[styles.button, styles.secondaryButton]} onPress={start}>
          <Text style={[styles.buttonText, styles.secondaryButtonText]}>Record again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {message ? <Text style={styles.message}>{message}</Text> : null}
      <TouchableOpacity style={styles.button} onPress={start}>
        <Text style={styles.buttonText}>
          {phase === 'denied' ? 'Try again' : `Start recording (${formatClock(maxDurationSeconds)})`}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', gap: 12 },
  dot: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#c0392b' },
  dotWarning: { backgroundColor: '#e67e22' },
  clock: { fontSize: 44, fontWeight: '300', fontVariant: ['tabular-nums'], color: '#333' },
  clockWarning: { color: '#e67e22' },
  hint: { fontSize: 15, color: '#888' },
  message: { fontSize: 15, color: '#c0392b', textAlign: 'center', marginBottom: 4 },
  button: {
    backgroundColor: '#333',
    borderRadius: 14,
    paddingVertical: 18,
    paddingHorizontal: 40,
    marginTop: 8,
  },
  stopButton: { backgroundColor: '#c0392b' },
  secondaryButton: { backgroundColor: 'transparent', borderWidth: 1, borderColor: '#ccc' },
  secondaryButtonText: { color: '#333' },
  buttonText: { color: '#fff', fontSize: 17, fontWeight: '600' },
});
