import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import RecordingReview from '@/components/RecordingReview';
import { deleteTalk, getTalk, type TalkDetail } from '@/lib/sessions';

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; talk: TalkDetail }
  | { status: 'error'; message: string };

/**
 * Deleting is irreversible and the button sits under the user's thumb right
 * after playback, so the first tap only arms it. `deleting` disables both
 * choices while the request is in flight.
 */
type DeleteState =
  | { status: 'idle' }
  | { status: 'confirming' }
  | { status: 'deleting' }
  | { status: 'error'; message: string };

/** "2026-09-21" → "Mon 21 Sep". Parsed as local, not UTC — see `localDate`. */
function formatDay(localDate: string): string {
  const [year, month, day] = localDate.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return '—';
  return `${Math.floor(seconds / 60)}:${`${seconds % 60}`.padStart(2, '0')}`;
}

export default function TalkDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [remove, setRemove] = useState<DeleteState>({ status: 'idle' });

  // Fetched once on mount rather than on focus: the signed playback URL is
  // minted per request, and refetching would swap it mid-playback.
  useEffect(() => {
    let cancelled = false;
    getTalk(id)
      .then((talk) => {
        if (!cancelled) setLoad({ status: 'ready', talk });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoad({
          status: 'error',
          message:
            error instanceof Error ? error.message : 'That talk could not be loaded.',
        });
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const confirmDelete = useCallback(async () => {
    setRemove({ status: 'deleting' });
    try {
      await deleteTalk(id);
      // Back to History, which refetches on focus and so drops this row.
      router.back();
    } catch (error) {
      setRemove({
        status: 'error',
        message: error instanceof Error ? error.message : 'Could not delete that talk.',
      });
    }
  }, [id, router]);

  if (load.status === 'loading') {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  if (load.status === 'error') {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorTitle}>Could not load that talk</Text>
        <Text style={styles.errorBody}>{load.message}</Text>
      </View>
    );
  }

  const { talk } = load;
  const busy = remove.status === 'deleting';

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.topic}>{talk.topicText}</Text>
      <View style={styles.meta}>
        <Text style={styles.metaText}>{formatDay(talk.localDate)}</Text>
        <Text style={styles.metaDot}>·</Text>
        <Text style={styles.metaText}>{formatDuration(talk.durationSeconds)}</Text>
        {talk.attemptNumber > 1 ? (
          <>
            <Text style={styles.metaDot}>·</Text>
            <Text style={styles.metaText}>attempt {talk.attemptNumber}</Text>
          </>
        ) : null}
      </View>

      {talk.audioUrl ? (
        <View style={styles.player}>
          <RecordingReview
            uri={talk.audioUrl}
            durationSeconds={talk.durationSeconds ?? 0}
            downloadFirst
          />
        </View>
      ) : (
        <Text style={styles.missingAudio}>The audio for this talk is unavailable.</Text>
      )}

      <Text style={styles.sectionLabel}>Transcript</Text>
      <Text style={talk.transcript ? styles.transcript : styles.transcriptEmpty}>
        {talk.transcript ?? 'No transcript was captured for this talk.'}
      </Text>

      <View style={styles.dangerZone}>
        {remove.status === 'idle' || remove.status === 'error' ? (
          <>
            {remove.status === 'error' ? (
              <Text style={styles.deleteError}>{remove.message}</Text>
            ) : null}
            <Pressable
              style={({ pressed }) => [styles.deleteButton, pressed && styles.pressed]}
              onPress={() => setRemove({ status: 'confirming' })}
              accessibilityRole="button"
            >
              <Text style={styles.deleteButtonText}>Delete talk</Text>
            </Pressable>
          </>
        ) : (
          <View style={styles.confirmBox}>
            <Text style={styles.confirmTitle}>Delete this talk?</Text>
            <Text style={styles.confirmBody}>
              The recording and its transcript are removed permanently. This cannot be
              undone.
            </Text>
            <View style={styles.confirmActions}>
              <Pressable
                style={({ pressed }) => [
                  styles.confirmDeleteButton,
                  pressed && styles.pressed,
                  busy && styles.busy,
                ]}
                onPress={() => void confirmDelete()}
                disabled={busy}
                accessibilityRole="button"
              >
                {busy ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.confirmDeleteText}>Delete</Text>
                )}
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.cancelButton,
                  pressed && styles.pressed,
                  busy && styles.busy,
                ]}
                onPress={() => setRemove({ status: 'idle' })}
                disabled={busy}
                accessibilityRole="button"
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </Pressable>
            </View>
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 24, paddingBottom: 48 },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    backgroundColor: '#fff',
  },
  errorTitle: { fontSize: 18, fontWeight: '600', marginBottom: 8 },
  errorBody: { fontSize: 15, color: '#c0392b', textAlign: 'center' },
  topic: { fontSize: 22, fontWeight: '600', lineHeight: 30, marginBottom: 10 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 28 },
  metaText: { fontSize: 14, color: '#888' },
  metaDot: { fontSize: 14, color: '#ccc' },
  player: { marginBottom: 32 },
  missingAudio: { fontSize: 15, color: '#888', fontStyle: 'italic', marginBottom: 32 },
  sectionLabel: {
    fontSize: 13,
    color: '#888',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  transcript: { fontSize: 16, lineHeight: 24, color: '#222' },
  transcriptEmpty: { fontSize: 15, color: '#888', fontStyle: 'italic' },
  dangerZone: {
    marginTop: 48,
    borderTopWidth: 1,
    borderTopColor: '#eee',
    paddingTop: 24,
  },
  deleteButton: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e0b4ad',
    paddingVertical: 16,
    alignItems: 'center',
  },
  deleteButtonText: { color: '#c0392b', fontSize: 16, fontWeight: '600' },
  deleteError: { fontSize: 15, color: '#c0392b', textAlign: 'center', marginBottom: 12 },
  confirmBox: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e0b4ad',
    backgroundColor: '#fdf5f4',
    padding: 20,
  },
  confirmTitle: { fontSize: 17, fontWeight: '600', marginBottom: 6 },
  confirmBody: { fontSize: 14, color: '#666', lineHeight: 20, marginBottom: 18 },
  confirmActions: { flexDirection: 'row', gap: 12 },
  confirmDeleteButton: {
    flex: 1,
    backgroundColor: '#c0392b',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmDeleteText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  cancelButton: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#ddd',
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButtonText: { color: '#666', fontSize: 16, fontWeight: '600' },
  pressed: { opacity: 0.7 },
  busy: { opacity: 0.5 },
});
