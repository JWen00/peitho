import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

export const MIN_TALKING_MINUTES = 1;
export const MAX_TALKING_MINUTES = 5;
export const DEFAULT_TALKING_MINUTES = 1;

const TALKING_MINUTES_KEY = 'talking_minutes';

/**
 * Which transcription the feedback coach scores from. Recording always uses the
 * on-device model; this only picks what feedback re-reads the talk with.
 * - 'device': the on-device transcript — private, free, no timings.
 * - 'elevenlabs': re-transcribe the audio via the `transcribe` function for word
 *   timestamps (accurate filler/pause feedback), at the cost of a network call.
 */
export type TranscriptionSource = 'device' | 'elevenlabs';
export const DEFAULT_TRANSCRIPTION_SOURCE: TranscriptionSource = 'device';

const TRANSCRIPTION_SOURCE_KEY = 'transcription_source';

function parseSource(value: string | null): TranscriptionSource {
  return value === 'elevenlabs' || value === 'device'
    ? value
    : DEFAULT_TRANSCRIPTION_SOURCE;
}

/**
 * Which model scores the feedback.
 * - 'native': the platform built-in (Apple Foundation Models on iOS 26+ / ML Kit
 *   on Android). Zero download, but needs a supported device.
 * - 'qwen3-1.7b': a downloadable LiteRT model (~2GB, one-time). Runs anywhere,
 *   including the iOS Simulator.
 */
export type FeedbackModel = 'native' | 'qwen3-1.7b';
export const DEFAULT_FEEDBACK_MODEL: FeedbackModel = 'qwen3-1.7b';

const FEEDBACK_MODEL_KEY = 'feedback_model';

function parseModel(value: string | null): FeedbackModel {
  return value === 'native' || value === 'qwen3-1.7b' ? value : DEFAULT_FEEDBACK_MODEL;
}

// Mirrors the platform split in lib/supabase.ts: expo-secure-store is
// native-only, so fall back to localStorage on web (guarded for static web
// rendering, which runs this in Node with no window).
async function readValue(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
  }
  return SecureStore.getItemAsync(key);
}

async function writeValue(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

function clampMinutes(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_TALKING_MINUTES;
  return Math.min(MAX_TALKING_MINUTES, Math.max(MIN_TALKING_MINUTES, Math.round(value)));
}

interface SettingsValue {
  talkingMinutes: number;
  setTalkingMinutes: (minutes: number) => void;
  transcriptionSource: TranscriptionSource;
  setTranscriptionSource: (source: TranscriptionSource) => void;
  feedbackModel: FeedbackModel;
  setFeedbackModel: (model: FeedbackModel) => void;
}

const SettingsContext = createContext<SettingsValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [talkingMinutes, setTalkingMinutesState] = useState(DEFAULT_TALKING_MINUTES);
  const [transcriptionSource, setTranscriptionSourceState] =
    useState<TranscriptionSource>(DEFAULT_TRANSCRIPTION_SOURCE);
  const [feedbackModel, setFeedbackModelState] =
    useState<FeedbackModel>(DEFAULT_FEEDBACK_MODEL);

  useEffect(() => {
    readValue(TALKING_MINUTES_KEY)
      .then((stored) => {
        if (stored !== null) setTalkingMinutesState(clampMinutes(Number(stored)));
      })
      .catch(() => {});
    readValue(TRANSCRIPTION_SOURCE_KEY)
      .then((stored) => {
        if (stored !== null) setTranscriptionSourceState(parseSource(stored));
      })
      .catch(() => {});
    readValue(FEEDBACK_MODEL_KEY)
      .then((stored) => {
        if (stored !== null) setFeedbackModelState(parseModel(stored));
      })
      .catch(() => {});
  }, []);

  const setTalkingMinutes = useCallback((minutes: number) => {
    const next = clampMinutes(minutes);
    setTalkingMinutesState(next);
    void writeValue(TALKING_MINUTES_KEY, String(next)).catch(() => {});
  }, []);

  const setTranscriptionSource = useCallback((source: TranscriptionSource) => {
    setTranscriptionSourceState(source);
    void writeValue(TRANSCRIPTION_SOURCE_KEY, source).catch(() => {});
  }, []);

  const setFeedbackModel = useCallback((model: FeedbackModel) => {
    setFeedbackModelState(model);
    void writeValue(FEEDBACK_MODEL_KEY, model).catch(() => {});
  }, []);

  return createElement(
    SettingsContext.Provider,
    {
      value: {
        talkingMinutes,
        setTalkingMinutes,
        transcriptionSource,
        setTranscriptionSource,
        feedbackModel,
        setFeedbackModel,
      },
    },
    children,
  );
}

export function useSettings(): SettingsValue {
  const value = useContext(SettingsContext);
  if (!value) throw new Error('useSettings must be used within a SettingsProvider');
  return value;
}
