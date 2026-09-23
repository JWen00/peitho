import { setAudioModeAsync } from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import * as Haptics from 'expo-haptics';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
  type ExpoSpeechRecognitionErrorCode,
} from 'expo-speech-recognition';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import LevelMeter from './LevelMeter';

/** Default speaking window when no limit is supplied; the user can change it in Settings. */
export const MAX_DURATION_SECONDS = 60;
/** How much time is left when the "wrap up" haptic + visual cue fires. */
const WARN_AT_SECONDS_LEFT = 10;
/**
 * Clock tick. Each tick is one bar of the level meter, so this is really the
 * meter's frame rate — 100ms scrolls smoothly, where the 200ms the countdown
 * alone needed looked stepped.
 */
const TICK_INTERVAL_MS = 100;

const RECOGNITION_LANG = 'en-US';

/**
 * How long to wait for the recognizer to hand back its final result and flush
 * the audio file after `stop()`.
 *
 * On iOS nothing is final until the session ends, so reading the transcript
 * the instant we ask it to stop would save the take without its last sentence.
 */
const FINALISE_TIMEOUT_MS = 4000;

/**
 * `volumechange` reports on the recognizer's own scale — roughly -2 to 10, with
 * anything below 0 counting as inaudible — not the dBFS `expo-audio` metering
 * used to give us. Speech lands in the low single digits, so 8 is a practical
 * ceiling rather than the theoretical one.
 */
const VOLUME_FLOOR = 0;
const VOLUME_CEILING = 8;

/**
 * 16kHz 16-bit mono, which is what the recognizer wants anyway.
 *
 * Left at the iOS default (44.1/48kHz float32) a persisted minute lands around
 * 11MB and is rejected by the API's 10MB cap; this keeps it near 2MB.
 */
const OUTPUT_SAMPLE_RATE = 16000;

function levelFromVolume(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const clamped = Math.min(VOLUME_CEILING, Math.max(VOLUME_FLOOR, value));
  return (clamped - VOLUME_FLOOR) / (VOLUME_CEILING - VOLUME_FLOOR);
}

/** Why a take was abandoned, in the user's terms rather than the platform's. */
const INTERRUPTION_MESSAGES: Partial<Record<ExpoSpeechRecognitionErrorCode, string>> = {
  'audio-capture': 'The microphone stopped working. Try again.',
  interrupted: 'Audio was interrupted by the system. Try again.',
  network: 'Speech recognition lost its connection. Try again.',
  'not-allowed': 'Microphone or speech access was withdrawn. Try again.',
  busy: 'The recognizer was still busy. Try again.',
};

export interface VoiceRecording {
  /** Local file URI of the finished clip. */
  uri: string;
  /** Length of the clip in whole seconds. */
  durationSeconds: number;
  /**
   * What the recognizer heard, or null when it produced nothing usable. A take
   * without a transcript is still a perfectly good take — the column, the API
   * and the detail screen all treat null as a first-class value.
   */
  transcript: string | null;
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

/** Best-effort cleanup of a clip nobody will ever review. */
function deleteQuietly(uri: string | null): void {
  if (!uri) return;
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // The document directory is ours alone, so a stray file is untidy, not a bug.
  }
}

/**
 * The record step of the core loop: request the mic, capture up to one minute,
 * and hand back a local file URI with whatever the recognizer heard.
 *
 * The recognizer owns the microphone rather than `expo-audio`, because the two
 * cannot both hold the input: its `recordingOptions.persist` writes the clip
 * while it transcribes, so one pass produces both and the transcript is ready
 * at review time instead of needing a second trip to the server.
 *
 * Deliberately knows nothing about topics or Supabase — the screen owns those.
 */
export default function VoiceRecorder({
  onStart,
  onComplete,
  onInterrupted,
  maxDurationSeconds = MAX_DURATION_SECONDS,
}: VoiceRecorderProps) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [lastRecording, setLastRecording] = useState<VoiceRecording | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [level, setLevel] = useState(0);

  // Read inside native event handlers, which close over the render that
  // registered them and would otherwise see a stale phase.
  const phaseRef = useRef<Phase>('idle');
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  // Guards the stop path. The cutoff timer, the Stop button, an error event and
  // the interruption handler can all race to end the same recording.
  const stoppingRef = useRef(false);
  const cutoffTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const warnedRef = useRef(false);
  const startedAtRef = useRef(0);

  // The take under construction. Refs rather than state: these are written from
  // native events many times a second and only read once, when the take ends.
  const audioUriRef = useRef<string | null>(null);
  const finalChunksRef = useRef<string[]>([]);
  const interimRef = useRef('');
  const levelRef = useRef(0);
  /** Resolves the `finish` wait when the recognizer reports it has stopped. */
  const endWaiterRef = useRef<(() => void) | null>(null);

  const elapsedSeconds = phase === 'recording' ? elapsedMs / 1000 : 0;
  const remainingSeconds = Math.max(0, maxDurationSeconds - elapsedSeconds);
  const isWrappingUp = phase === 'recording' && remainingSeconds <= WARN_AT_SECONDS_LEFT;

  const clearTimers = useCallback(() => {
    if (cutoffTimerRef.current !== null) {
      clearTimeout(cutoffTimerRef.current);
      cutoffTimerRef.current = null;
    }
    if (tickTimerRef.current !== null) {
      clearInterval(tickTimerRef.current);
      tickTimerRef.current = null;
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
      clearTimers();

      // Wall clock rather than the file's own length: it is the same number the
      // countdown has been showing, so the saved duration matches what the user
      // just watched tick down.
      const durationSeconds = Math.min(
        maxDurationSeconds,
        Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000))
      );

      // `stop()` asks for a last result and flushes the file; `abort()` drops
      // both. Either way the work lands on the `end` event, so wait for it
      // rather than reading a half-written file and a half-finished sentence.
      await new Promise<void>((resolve) => {
        let settled = false;
        const done = () => {
          if (settled) return;
          settled = true;
          endWaiterRef.current = null;
          resolve();
        };

        endWaiterRef.current = done;
        try {
          if (keep) ExpoSpeechRecognitionModule.stop();
          else ExpoSpeechRecognitionModule.abort();
        } catch {
          done();
        }
        // The recognizer can die without ever reporting `end`. Losing the take
        // to a hang would be worse than saving it a beat late.
        setTimeout(done, FINALISE_TIMEOUT_MS);
      });

      // Returning the session to playback mode matters on iOS: the recognizer
      // leaves the session in a recording category, which routes later playback
      // to the earpiece.
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});

      const uri = audioUriRef.current;
      // `continuous` delivers a *sequence* of final results across one take,
      // each covering only the speech since the last, so the whole minute is
      // the chunks joined — not the newest one. Any interim tail is included
      // because text that never got to finalise is still text the user said.
      const transcript =
        [...finalChunksRef.current, interimRef.current]
          .map((part) => part.trim())
          .filter(Boolean)
          .join(' ') || null;

      if (!keep || !uri) {
        // The document directory is never reclaimed by the OS, so a partial
        // clip nobody asked for would sit there forever.
        deleteQuietly(uri);
        audioUriRef.current = null;
        setLastRecording(null);
        setPhase('idle');
        setMessage(reason ?? 'Recording interrupted. Try again.');
        if (reason) onInterrupted?.(reason);
        stoppingRef.current = false;
        return;
      }

      const recording: VoiceRecording = { uri, durationSeconds, transcript };
      setLastRecording(recording);
      setPhase('finished');
      setMessage(null);
      stoppingRef.current = false;
      onComplete?.(recording);
    },
    [clearTimers, maxDurationSeconds, onComplete, onInterrupted]
  );

  // Native events ------------------------------------------------------------

  // `persist` names the file for us, and the uri is only safe to touch once
  // `audioend` has fired.
  useSpeechRecognitionEvent('audiostart', (event) => {
    if (event.uri) audioUriRef.current = event.uri;
  });

  useSpeechRecognitionEvent('audioend', (event) => {
    if (event.uri) audioUriRef.current = event.uri;
  });

  useSpeechRecognitionEvent('result', (event) => {
    const best = event.results[0];
    if (!best) return;
    if (event.isFinal) {
      if (best.transcript.trim()) finalChunksRef.current.push(best.transcript.trim());
      interimRef.current = '';
    } else {
      interimRef.current = best.transcript;
    }
  });

  useSpeechRecognitionEvent('error', (event) => {
    // Silence is not a failure. The take still has audio worth reviewing, it
    // just has no words in it, and null is a transcript the rest of the app
    // already knows how to render.
    if (event.error === 'no-speech' || event.error === 'speech-timeout') return;
    // Our own discard path calls `abort()`, which reports back as an error.
    if (event.error === 'aborted') return;
    if (phaseRef.current !== 'recording') return;
    void finish(false, INTERRUPTION_MESSAGES[event.error] ?? 'Recording was interrupted. Try again.');
  });

  useSpeechRecognitionEvent('end', () => {
    endWaiterRef.current?.();

    // The recognizer stopped on its own — a long silence, or Android 12 and
    // below, where `continuous` is unsupported and the session ends at the
    // first final result. The audio up to here is intact and consistent with
    // the transcript, so keep the take rather than discarding a real answer.
    if (phaseRef.current === 'recording' && !stoppingRef.current) {
      void finish(true);
    }
  });

  useSpeechRecognitionEvent('volumechange', (event) => {
    // Sampled by the tick below rather than pushed into state, so the meter
    // still advances exactly one bar per frame the way the countdown does.
    levelRef.current = levelFromVolume(event.value);
  });

  // Controls -----------------------------------------------------------------

  const start = useCallback(async () => {
    setMessage(null);
    setPhase('preparing');

    if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
      setPhase('error');
      setMessage('Speech recognition is not available on this device.');
      return;
    }
    // Without this the recognizer transcribes but writes no file, and a take
    // with no audio is not a take.
    if (!ExpoSpeechRecognitionModule.supportsRecording()) {
      setPhase('error');
      setMessage('This device cannot record while transcribing.');
      return;
    }

    let permission = await ExpoSpeechRecognitionModule.getPermissionsAsync();
    if (!permission.granted && permission.canAskAgain) {
      permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    }
    if (!permission.granted) {
      setPhase('denied');
      setMessage(
        permission.canAskAgain
          ? 'Peitho needs the microphone and speech recognition to record your answer.'
          : 'Microphone or speech access is off. Enable both in Settings to record.'
      );
      return;
    }

    try {
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
        interruptionMode: 'doNotMix',
      });

      stoppingRef.current = false;
      warnedRef.current = false;
      audioUriRef.current = null;
      finalChunksRef.current = [];
      interimRef.current = '';
      levelRef.current = 0;
      startedAtRef.current = Date.now();
      setLevel(0);
      setElapsedMs(0);
      setLastRecording(null);

      ExpoSpeechRecognitionModule.start({
        lang: RECOGNITION_LANG,
        // Without this the session ends at the first pause, taking the clip
        // with it — a speaker gathering their thoughts would cut their own
        // take short.
        continuous: true,
        interimResults: true,
        addsPunctuation: true,
        recordingOptions: {
          persist: true,
          // Defaults to the cache directory, which the OS may purge before the
          // clip has been uploaded — and a save that is retried after a failure
          // needs the file to still be there.
          outputDirectory: Paths.document.uri,
          outputSampleRate: OUTPUT_SAMPLE_RATE,
          outputEncoding: 'pcmFormatInt16',
        },
        volumeChangeEventOptions: { enabled: true, intervalMillis: TICK_INTERVAL_MS },
      });

      setPhase('recording');
      onStart?.();

      clearTimers();
      tickTimerRef.current = setInterval(() => {
        const elapsed = Date.now() - startedAtRef.current;
        setElapsedMs(elapsed);
        setLevel(levelRef.current);
        // Backstop for the cutoff timer below: a starved `setTimeout` should
        // not hand back a take longer than the window allows.
        if (elapsed >= maxDurationSeconds * 1000) void finish(true);
      }, TICK_INTERVAL_MS);

      // The plan's hard cutoff: a timer stops the recording, never the user.
      cutoffTimerRef.current = setTimeout(() => {
        void finish(true);
      }, maxDurationSeconds * 1000);
    } catch (error) {
      setPhase('error');
      setMessage(error instanceof Error ? error.message : 'Could not start recording.');
    }
  }, [clearTimers, finish, maxDurationSeconds, onStart]);

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

  // Backgrounding or a call means the clip is no longer trustworthy. Stop and
  // discard rather than save a fragment. Hardware failures arrive as `error`
  // events instead, which the handler above turns into the same outcome.
  useEffect(() => {
    if (phase !== 'recording') return;
    const subscription = AppState.addEventListener('change', (next) => {
      if (next !== 'active') {
        void finish(false, 'Recording stopped when you left the app. Try again.');
      }
    });
    return () => subscription.remove();
  }, [finish, phase]);

  // Unmounting mid-take would otherwise leave the recognizer holding the mic.
  useEffect(
    () => () => {
      clearTimers();
      try {
        ExpoSpeechRecognitionModule.abort();
      } catch {
        // Not running, which is the state we wanted anyway.
      }
    },
    [clearTimers]
  );

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
        <LevelMeter level={level} durationMillis={elapsedMs} active warning={isWrappingUp} />
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
