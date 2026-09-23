import { useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import RecordingReview from '@/components/RecordingReview';
import VoiceRecorder, { type VoiceRecording } from '@/components/VoiceRecorder';
import { discardRecording, newTalkId, saveSession } from '@/lib/sessions';
import { getTodaysTopic } from '@/lib/topics';

type SaveState =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'saved'; attemptNumber: number }
  | { status: 'error'; message: string };

export default function PracticeScreen() {
  // Stable for the whole local day, so a retry gets the same prompt.
  const [topic] = useState(getTodaysTopic);
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
      // The local clip is gone once uploaded, so drop our reference to it too.
      setRecording(null);
      setClientTalkId(null);
      setSave({ status: 'saved', attemptNumber: saved.attemptNumber });
    } catch (error) {
      setSave({
        status: 'error',
        message: error instanceof Error ? error.message : 'Could not save that recording.',
      });
    }
  }, [recording, clientTalkId, topic]);

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
      <Text style={styles.label}>Today's topic</Text>
      <Text style={styles.topic}>{topic.text}</Text>

      <VoiceRecorder
        onStart={handleStart}
        onComplete={handleComplete}
        onInterrupted={handleInterrupted}
      />

      {recording ? (
        <View style={styles.review}>
          <RecordingReview uri={recording.uri} durationSeconds={recording.durationSeconds} />

          {save.status === 'error' ? <Text style={styles.error}>{save.message}</Text> : null}

          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.saveButton, isSaving && styles.buttonBusy]}
              onPress={handleSave}
              disabled={isSaving}>
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
              disabled={isSaving}>
              <Text style={styles.discardButtonText}>Discard</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      {save.status === 'saved' ? (
        <Text style={styles.saved}>
          Saved{save.attemptNumber > 1 ? ` — attempt ${save.attemptNumber}` : ''}.
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32, backgroundColor: '#fff' },
  label: { fontSize: 13, color: '#888', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 16 },
  topic: { fontSize: 24, fontWeight: '600', textAlign: 'center', marginBottom: 48, lineHeight: 32 },
  review: { alignSelf: 'stretch', marginTop: 28, gap: 18 },
  actions: { flexDirection: 'row', justifyContent: 'center', gap: 12 },
  error: { fontSize: 15, color: '#c0392b', textAlign: 'center' },
  saved: { fontSize: 15, color: '#2e7d32', marginTop: 20 },
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
