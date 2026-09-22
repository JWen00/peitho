import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { listTalks, type TalkSummary } from '@/lib/sessions';

type LoadState =
  | { status: 'loading' }
  | { status: 'ready' }
  | { status: 'error'; message: string };

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
      accessibilityLabel={`Open talk: ${talk.topicText}`}>
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

export default function HistoryScreen() {
  const router = useRouter();
  const [talks, setTalks] = useState<TalkSummary[]>([]);
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [refreshing, setRefreshing] = useState(false);
  const [paging, setPaging] = useState(false);
  const cursor = useRef<string | null>(null);

  const loadFirstPage = useCallback(async (isRefresh: boolean) => {
    if (isRefresh) setRefreshing(true);
    else setLoad({ status: 'loading' });
    try {
      const page = await listTalks();
      setTalks(page.talks);
      cursor.current = page.nextCursor;
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

  // Refetch on focus so a talk saved on the Practice tab shows up here without
  // the user having to pull to refresh.
  useFocusEffect(
    useCallback(() => {
      loadFirstPage(false);
    }, [loadFirstPage]),
  );

  const loadNextPage = useCallback(async () => {
    // `paging` guards against FlatList firing onEndReached repeatedly while a
    // fetch is already in flight; a null cursor means there is nothing left.
    if (paging || cursor.current === null) return;
    setPaging(true);
    try {
      const page = await listTalks(cursor.current);
      setTalks((previous) => [...previous, ...page.talks]);
      cursor.current = page.nextCursor;
    } catch {
      // A failed page is not worth destroying the list the user is reading.
      // They can pull to refresh, or scroll again to retry.
    } finally {
      setPaging(false);
    }
  }, [paging]);

  if (load.status === 'loading') {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <FlatList
      // The background belongs on the list itself, not only on
      // contentContainerStyle: that one paints behind the rows, leaving the
      // area below a short list showing the default grey.
      style={styles.list}
      data={talks}
      keyExtractor={(talk) => talk.id}
      renderItem={({ item }) => (
        <TalkRow talk={item} onPress={() => router.push(`/session/${item.id}`)} />
      )}
      contentContainerStyle={talks.length === 0 ? styles.emptyContainer : styles.listContainer}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => loadFirstPage(true)} />
      }
      onEndReached={loadNextPage}
      onEndReachedThreshold={0.4}
      ListFooterComponent={
        paging ? <ActivityIndicator style={styles.footerSpinner} /> : null
      }
      ListEmptyComponent={
        // The error lives inside the list rather than replacing it, so the
        // RefreshControl above stays reachable — "pull down to try again" has
        // to have something to pull.
        load.status === 'error' ? (
          <View style={styles.centered}>
            <Text style={styles.errorTitle}>Could not load your talks</Text>
            <Text style={styles.errorBody}>{load.message}</Text>
            <Text style={styles.errorHint}>Pull down to try again.</Text>
          </View>
        ) : (
          <View style={styles.centered}>
            <Text style={styles.emptyTitle}>No talks yet</Text>
            <Text style={styles.emptyBody}>
              Record your first minute on the Practice tab and it will show up here.
            </Text>
          </View>
        )
      }
    />
  );
}

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: '#fff' },
  listContainer: { paddingVertical: 8 },
  emptyContainer: { flexGrow: 1 },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    backgroundColor: '#fff',
  },
  row: { paddingVertical: 16, paddingHorizontal: 20 },
  rowPressed: { backgroundColor: '#f4f4f4' },
  rowTopic: { fontSize: 16, fontWeight: '500', lineHeight: 22, marginBottom: 6 },
  rowMeta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowMetaText: { fontSize: 13, color: '#888' },
  rowMetaDot: { fontSize: 13, color: '#ccc' },
  separator: { height: 1, backgroundColor: '#eee', marginLeft: 20 },
  footerSpinner: { paddingVertical: 20 },
  emptyTitle: { fontSize: 18, fontWeight: '600', marginBottom: 8 },
  emptyBody: { fontSize: 15, color: '#888', textAlign: 'center', lineHeight: 21 },
  errorTitle: { fontSize: 18, fontWeight: '600', marginBottom: 8 },
  errorBody: { fontSize: 15, color: '#c0392b', textAlign: 'center', marginBottom: 12 },
  errorHint: { fontSize: 14, color: '#888' },
});
