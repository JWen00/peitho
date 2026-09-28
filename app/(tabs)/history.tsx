import Constants from 'expo-constants';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { PracticeHeatmap } from '@/components/PracticeHeatmap';
import {
  getTalkStats,
  listTalks,
  type TalkStats,
  type TalkSummary,
} from '@/lib/sessions';

/** The summary shows only the most recent handful; the heatmap covers the rest. */
const RECENT_LIMIT = 3;

type LoadState =
  { status: 'loading' } | { status: 'ready' } | { status: 'error'; message: string };

/** "2026-09-21" → "Mon 21 Sep". Parsed as local, not UTC — see `localDate`. */
function formatDay(localDate: string): string {
  const [year, month, day] = localDate.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return '—';
  return `${Math.floor(seconds / 60)}:${`${seconds % 60}`.padStart(2, '0')}`;
}

function TalkRow({ talk, onPress }: { talk: TalkSummary; onPress: () => void }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Open talk: ${talk.topicText}`}
    >
      <Text style={styles.rowTopic} numberOfLines={2}>
        {talk.topicText}
      </Text>
      <View style={styles.rowMeta}>
        <Text style={styles.rowMetaText}>{formatDay(talk.localDate)}</Text>
        <Text style={styles.rowMetaDot}>·</Text>
        <Text style={styles.rowMetaText}>{formatDuration(talk.durationSeconds)}</Text>
        {talk.attemptNumber > 1 ? (
          <>
            <Text style={styles.rowMetaDot}>·</Text>
            <Text style={styles.rowMetaText}>attempt {talk.attemptNumber}</Text>
          </>
        ) : null}
      </View>
    </Pressable>
  );
}

function StatCard({ value, label }: { value: number; label: string }) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

export default function HistoryScreen() {
  const router = useRouter();
  const [talks, setTalks] = useState<TalkSummary[]>([]);
  const [stats, setStats] = useState<TalkStats | null>(null);
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [refreshing, setRefreshing] = useState(false);

  const loadSummary = useCallback(async (isRefresh: boolean) => {
    if (isRefresh) setRefreshing(true);
    else setLoad({ status: 'loading' });
    try {
      // The recent list and the headline stats are independent reads, so fire
      // them together rather than waiting one out before starting the other.
      const [page, nextStats] = await Promise.all([
        listTalks({ limit: RECENT_LIMIT }),
        getTalkStats(),
      ]);
      setTalks(page.talks);
      setStats(nextStats);
      setLoad({ status: 'ready' });
    } catch (error) {
      setLoad({
        status: 'error',
        message: error instanceof Error ? error.message : 'Could not load your talks.',
      });
    } finally {
      setRefreshing(false);
    }
  }, []);

  // Refetch on focus so a talk just saved on the Practice tab moves the stats and
  // shows up at the top of the recent list without a manual reload.
  useFocusEffect(
    useCallback(() => {
      loadSummary(false);
    }, [loadSummary]),
  );

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => loadSummary(true)} />
      }
    >
      <Text style={styles.heading}>Your practice</Text>
      <Text style={styles.subheading}>
        Track your streak and look back on recent talks.
      </Text>

      <View style={styles.stats}>
        <StatCard value={stats?.currentStreak ?? 0} label="Day streak" />
        <StatCard value={stats?.totalTalks ?? 0} label="Total talks" />
      </View>

      <View style={styles.heatmapCard}>
        <PracticeHeatmap />
      </View>

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionLabel}>Recent talks</Text>
        {load.status === 'ready' && talks.length > 0 ? (
          <Pressable
            onPress={() => router.push('/talks')}
            accessibilityRole="button"
            accessibilityLabel="View all talks"
            hitSlop={8}
          >
            <Text style={styles.viewAll}>View all</Text>
          </Pressable>
        ) : null}
      </View>
      {load.status === 'loading' ? (
        <View style={styles.centered}>
          <ActivityIndicator />
        </View>
      ) : load.status === 'error' ? (
        <View style={styles.centered}>
          <Text style={styles.errorTitle}>Could not load your talks</Text>
          <Text style={styles.errorBody}>{load.message}</Text>
          <Text style={styles.errorHint}>Pull down to try again.</Text>
        </View>
      ) : talks.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.emptyTitle}>No talks yet</Text>
          <Text style={styles.emptyBody}>
            Record your first minute on the Practice tab and it will show up here.
          </Text>
        </View>
      ) : (
        <View style={styles.recent}>
          {talks.map((talk, index) => (
            <View key={talk.id}>
              {index > 0 ? <View style={styles.separator} /> : null}
              <TalkRow talk={talk} onPress={() => router.push(`/session/${talk.id}`)} />
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff' },
  // No nav header on this tab, so pad past the status bar ourselves.
  content: { paddingTop: Constants.statusBarHeight + 16, paddingBottom: 40 },
  heading: { fontSize: 28, fontWeight: '700', paddingHorizontal: 20 },
  subheading: {
    fontSize: 15,
    color: '#888',
    lineHeight: 21,
    marginTop: 4,
    paddingHorizontal: 20,
  },
  stats: { flexDirection: 'row', gap: 12, paddingHorizontal: 20, marginTop: 24 },
  statCard: {
    flex: 1,
    backgroundColor: '#f6f5f9',
    borderRadius: 16,
    paddingVertical: 18,
    paddingHorizontal: 16,
  },
  statValue: { fontSize: 30, fontWeight: '700', color: '#333' },
  statLabel: { fontSize: 13, color: '#888', marginTop: 4 },
  heatmapCard: { paddingHorizontal: 20, marginTop: 28 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginTop: 32,
    marginBottom: 4,
  },
  sectionLabel: {
    fontSize: 13,
    color: '#888',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  viewAll: { fontSize: 14, color: '#6031c4', fontWeight: '600' },
  recent: { marginTop: 4 },
  row: { paddingVertical: 16, paddingHorizontal: 20 },
  rowPressed: { backgroundColor: '#f4f4f4' },
  rowTopic: { fontSize: 16, fontWeight: '500', lineHeight: 22, marginBottom: 6 },
  rowMeta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowMetaText: { fontSize: 13, color: '#888' },
  rowMetaDot: { fontSize: 13, color: '#ccc' },
  separator: { height: 1, backgroundColor: '#eee', marginLeft: 20 },
  centered: { alignItems: 'center', paddingHorizontal: 32, paddingVertical: 32 },
  emptyTitle: { fontSize: 18, fontWeight: '600', marginBottom: 8 },
  emptyBody: { fontSize: 15, color: '#888', textAlign: 'center', lineHeight: 21 },
  errorTitle: { fontSize: 18, fontWeight: '600', marginBottom: 8 },
  errorBody: { fontSize: 15, color: '#c0392b', textAlign: 'center', marginBottom: 12 },
  errorHint: { fontSize: 14, color: '#888' },
});
