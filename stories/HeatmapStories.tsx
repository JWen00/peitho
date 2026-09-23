import { Stack } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { buildWeeks, HeatmapView, type HeatmapState } from '@/components/PracticeHeatmap';
import { localDateString } from '@/lib/topics';

/**
 * A dev-only gallery for `PracticeHeatmap`: pick a state from the switcher and
 * see exactly how the heatmap renders it, without a network or a real account.
 * The switcher drives the pure `HeatmapView`, so what shows here is the same
 * component the app mounts — only the data is fabricated.
 *
 * Lives outside `app/` on purpose: it is not a shipped route. The `__DEV__`
 * shim at `app/stories.tsx` is the only entry, and it pulls this in only in
 * development — see the note there.
 */

const DAYS = 365;

/** The trailing-year window the real component uses, so the grid looks true. */
function standardRange(): { from: string; to: string } {
  const to = localDateString();
  const fromDate = new Date();
  fromDate.setHours(0, 0, 0, 0);
  fromDate.setDate(fromDate.getDate() - (DAYS - 1));
  return { from: localDateString(fromDate), to };
}

/** Stable per-date pseudo-random in [0, 1) so a story looks the same each render. */
function seeded(date: string): number {
  let hash = 0;
  for (let i = 0; i < date.length; i++) {
    hash = (hash * 31 + date.charCodeAt(i)) | 0;
  }
  return (Math.abs(hash) % 1000) / 1000;
}

type StoryName = 'Loading' | 'Error' | 'Empty' | 'Sparse' | 'Dense';

const STORIES: StoryName[] = ['Loading', 'Error', 'Empty', 'Sparse', 'Dense'];

const BLURBS: Record<StoryName, string> = {
  Loading: 'Waiting on the heatmap RPC.',
  Error: 'The fetch failed — the message the container would surface.',
  Empty: 'A real account with no talks yet: every day is the empty track colour.',
  Sparse: 'A few scattered days, mostly single talks — early-days usage.',
  Dense: 'A committed streak: most days filled, with 2- and 3+-talk days mixed in.',
};

export default function HeatmapStories() {
  const [story, setStory] = useState<StoryName>('Dense');

  // Built once: the range and every story's fabricated counts. Recomputing per
  // render would reshuffle Sparse/Dense and defeat the point of a stable gallery.
  const states = useMemo<Record<StoryName, HeatmapState>>(() => {
    const { from, to } = standardRange();
    const weeks = buildWeeks(from, to);
    const dates = weeks.flat().filter((d): d is string => d !== null);

    const sparse = new Map<string, number>();
    const dense = new Map<string, number>();
    for (const date of dates) {
      const r = seeded(date);
      // Sparse: ~1 in 12 days, almost always a single talk.
      if (r < 0.08) sparse.set(date, r < 0.015 ? 2 : 1);
      // Dense: ~70% of days, weighted toward 1 but with plenty of 2 and 3+.
      if (r < 0.7) dense.set(date, r < 0.12 ? 4 : r < 0.32 ? 2 : 1);
    }

    return {
      Loading: { status: 'loading' },
      Error: { status: 'error', message: 'Could not load your activity.' },
      Empty: { status: 'ready', counts: new Map(), weeks },
      Sparse: { status: 'ready', counts: sparse, weeks },
      Dense: { status: 'ready', counts: dense, weeks },
    };
  }, []);

  return (
    <>
      <Stack.Screen options={{ title: 'Heatmap stories' }} />
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <View style={styles.switcher}>
          {STORIES.map((name) => {
            const active = name === story;
            return (
              <Pressable
                key={name}
                onPress={() => setStory(name)}
                style={[styles.pill, active && styles.pillActive]}
              >
                <Text style={[styles.pillText, active && styles.pillTextActive]}>{name}</Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.blurb}>{BLURBS[story]}</Text>

        <View style={styles.card}>
          <HeatmapView state={states[story]} />
        </View>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 20 },
  switcher: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: '#f0eef4',
  },
  pillActive: { backgroundColor: '#6031c4' },
  pillText: { fontSize: 14, color: '#555', fontWeight: '500' },
  pillTextActive: { color: '#fff' },
  blurb: { fontSize: 13, color: '#888', lineHeight: 19, marginTop: 14 },
  card: {
    marginTop: 16,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#eee',
    backgroundColor: '#fff',
  },
});
