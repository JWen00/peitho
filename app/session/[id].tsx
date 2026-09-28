import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import RecordingReview from '@/components/RecordingReview';
import {
  deleteTalk,
  getTalk,
  getTalksByTopic,
  type TalkDetail,
  type TalkSummary,
} from '@/lib/sessions';

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; talk: TalkDetail }
  | { status: 'error'; message: string };

/** "2026-09-21" → "Mon 21 Sep 2026". Parsed as local, not UTC — see `localDate`. */
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

/** A compact tappable row for one other attempt on the same topic. */
function AttemptRow({ talk, onPress }: { talk: TalkSummary; onPress: () => void }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.attemptRow, pressed && styles.attemptRowPressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Open attempt from ${formatDay(talk.localDate)}`}
    >
      <View style={styles.attemptInfo}>
        <Text style={styles.attemptDate}>{formatDay(talk.localDate)}</Text>
        <View style={styles.attemptMeta}>
          <Text style={styles.attemptMetaText}>
            {formatDuration(talk.durationSeconds)}
          </Text>
          {talk.attemptNumber > 1 ? (
            <>
              <Text style={styles.attemptMetaDot}>·</Text>
              <Text style={styles.attemptMetaText}>attempt {talk.attemptNumber}</Text>
            </>
          ) : null}
        </View>
      </View>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

export default function TalkDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  // Other attempts on the same topic. null while unknown; [] once we know there
  // are none — the section only renders when there is at least one.
  const [attempts, setAttempts] = useState<TalkSummary[] | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Fetched once on mount rather than on focus: the signed playback URL is
  // minted per request, and refetching would swap it mid-playback.
  useEffect(() => {
    let cancelled = false;
    getTalk(id)
      .then((talk) => {
        if (cancelled) return;
        setLoad({ status: 'ready', talk });
        // Best-effort: the transcript is the point of this screen, so a failure
        // to load sibling attempts should not take the whole screen down.
        getTalksByTopic(talk.topicText, id)
          .then((others) => {
            if (!cancelled) setAttempts(others);
          })
          .catch(() => {
            if (!cancelled) setAttempts([]);
          });
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
    setDeleting(true);
    try {
      await deleteTalk(id);
      // Back to History, which refetches on focus and so drops this row.
      router.back();
    } catch (error) {
      setDeleting(false);
      Alert.alert(
        'Could not delete',
        error instanceof Error ? error.message : 'Could not delete that talk.',
      );
    }
  }, [id, router]);

  // Tucked behind the header's "…" so an irreversible action is not sitting
  // under the thumb; the alert is the confirmation step.
  const promptDelete = useCallback(() => {
    Alert.alert(
      'Delete this talk?',
      'The recording and its transcript are removed permanently. This can’t be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => void confirmDelete() },
      ],
    );
  }, [confirmDelete]);

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

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable
              onPress={promptDelete}
              disabled={deleting}
              hitSlop={12}
              style={styles.headerButton}
              accessibilityRole="button"
              accessibilityLabel="Talk options"
            >
              <SymbolView
                name={{ ios: 'ellipsis', android: 'more_horiz', web: 'more_horiz' }}
                tintColor="#333"
                size={22}
              />
            </Pressable>
          ),
        }}
      />

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

      {attempts && attempts.length > 0 ? (
        <View style={styles.attemptsSection}>
          <Text style={styles.sectionLabel}>Other attempts on this topic</Text>
          <View style={styles.attemptsList}>
            {attempts.map((attempt, index) => (
              <View key={attempt.id}>
                {index > 0 ? <View style={styles.attemptSeparator} /> : null}
                <AttemptRow
                  talk={attempt}
                  onPress={() => router.push(`/session/${attempt.id}`)}
                />
              </View>
            ))}
          </View>
        </View>
      ) : null}
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
  headerButton: { paddingHorizontal: 8, paddingVertical: 4 },
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
  attemptsSection: {
    marginTop: 40,
    borderTopWidth: 1,
    borderTopColor: '#eee',
    paddingTop: 24,
  },
  attemptsList: { marginTop: 2 },
  attemptRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
  },
  attemptRowPressed: { opacity: 0.6 },
  attemptSeparator: { height: 1, backgroundColor: '#eee' },
  attemptInfo: { flex: 1 },
  attemptDate: { fontSize: 16, fontWeight: '500', color: '#222' },
  attemptMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  attemptMetaText: { fontSize: 13, color: '#888' },
  attemptMetaDot: { fontSize: 13, color: '#ccc' },
  chevron: { fontSize: 24, color: '#ccc', marginLeft: 12 },
});
