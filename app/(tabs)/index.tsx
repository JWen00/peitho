import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import PlanningTimer from '@/components/PlanningTimer';
import RecordingReview from '@/components/RecordingReview';
import VoiceRecorder, { type VoiceRecording } from '@/components/VoiceRecorder';
import { discardRecording, newTalkId, saveSession } from '@/lib/sessions';
import { useSettings } from '@/lib/settings';
import { getTodaysTopic } from '@/lib/topics';

type SaveState =
  { status: 'idle' } | { status: 'saving' } | { status: 'error'; message: string };

export default function PracticeScreen() {
  const router = useRouter();
  const { talkingMinutes } = useSettings();
  // Stable for the whole local day, so a retry gets the same prompt.
  const [topic] = useState(getTodaysTopic);
  // The core loop's plan step gates the recorder: the speaker plans, then the
  // mic opens. Saving sends us to the talk's detail screen and resets this back
  // to 'planning', so returning to the tab starts a clean flow.
  const [stage, setStage] = useState<'planning' | 'recording'>('planning');
  const [recording, setRecording] = useState<VoiceRecording | null>(null);
  // Minted with the take, not with the save, so "Try saving again" resends the
  // same key and the server returns the original talk instead of storing the
  // minute twice. Moves in lockstep with `recording`.
  const [clientTalkId, setClientTalkId] = useState<string | null>(null);
  const [save, setSave] = useState<SaveState>({ status: 'idle' });

  // A new take supersedes whatever was under review. Without this the previous
  // clip stays playable and savable while the next one is being recorded.
  const handleStart = useCallback(() => {
    setRecording((previous) => {
      if (previous) discardRecording(previous.uri);
      return null;
    });
    setClientTalkId(null);
    setSave({ status: 'idle' });
  }, []);

  const handleComplete = useCallback((result: VoiceRecording) => {
    // Already carries its transcript: the recognizer produced it while the take
    // was being recorded, so there is nothing left to wait for here.
    setRecording(result);
    setClientTalkId(newTalkId());
    setSave({ status: 'idle' });
  }, []);

  const handleInterrupted = useCallback(() => {
    setRecording(null);
    setClientTalkId(null);
    setSave({ status: 'idle' });
  }, []);

  const handleSave = useCallback(async () => {
    if (!recording || !clientTalkId) return;
    setSave({ status: 'saving' });
    try {
      const saved = await saveSession({
        topic,
        uri: recording.uri,
        durationSeconds: recording.durationSeconds,
        transcript: recording.transcript,
        clientTalkId,
      });
      // The local clip is gone once uploaded, so drop our reference to it too,
      // and reset the flow so a return to this tab starts fresh at planning.
      setRecording(null);
      setClientTalkId(null);
      setSave({ status: 'idle' });
      setStage('planning');
      // Open the saved talk so the user reviews it and reads the transcript.
      router.push(`/session/${saved.id}`);
    } catch (error) {
      setSave({
        status: 'error',
        message:
          error instanceof Error ? error.message : 'Could not save that recording.',
      });
    }
  }, [recording, clientTalkId, topic, router]);

  const handleDiscard = useCallback(() => {
    if (!recording) return;
    discardRecording(recording.uri);
    setRecording(null);
    setClientTalkId(null);
    setSave({ status: 'idle' });
  }, [recording]);

  const isSaving = save.status === 'saving';

  return (
    <View style={styles.container}>
      <Text style={styles.label}>Today&apos;s topic</Text>
      <Text style={styles.topic}>{topic.text}</Text>

      {stage === 'planning' ? (
        <PlanningTimer onReady={() => setStage('recording')} />
      ) : (
        <VoiceRecorder
          onStart={handleStart}
          onComplete={handleComplete}
          onInterrupted={handleInterrupted}
          maxDurationSeconds={talkingMinutes * 60}
        />
      )}

      {recording ? (
        <View style={styles.review}>
          <RecordingReview
            uri={recording.uri}
            durationSeconds={recording.durationSeconds}
          />

          {save.status === 'error' ? (
            <Text style={styles.error}>{save.message}</Text>
          ) : null}

          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.saveButton, isSaving && styles.buttonBusy]}
              onPress={handleSave}
              disabled={isSaving}
            >
              {isSaving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.saveButtonText}>
                  {save.status === 'error' ? 'Try saving again' : 'Save'}
                </Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.discardButton, isSaving && styles.buttonBusy]}
              onPress={handleDiscard}
              disabled={isSaving}
            >
              <Text style={styles.discardButtonText}>Discard</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    backgroundColor: '#fff',
  },
  label: {
    fontSize: 13,
    color: '#888',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 16,
  },
  topic: {
    fontSize: 24,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 48,
    lineHeight: 32,
  },
  review: { alignSelf: 'stretch', marginTop: 28, gap: 18 },
  actions: { flexDirection: 'row', justifyContent: 'center', gap: 12 },
  error: { fontSize: 15, color: '#c0392b', textAlign: 'center' },
  saveButton: {
    backgroundColor: '#2e7d32',
    borderRadius: 14,
    paddingVertical: 18,
    paddingHorizontal: 40,
    minWidth: 160,
    alignItems: 'center',
  },
  saveButtonText: { color: '#fff', fontSize: 17, fontWeight: '600' },
  discardButton: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#ccc',
    paddingVertical: 18,
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  discardButtonText: { color: '#666', fontSize: 17, fontWeight: '600' },
  buttonBusy: { opacity: 0.6 },
});
