import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Redirect } from 'expo-router';

/**
 * Dev-only entry to the story galleries.
 *
 * The galleries themselves live outside `app/` (in `stories/`) so they are never
 * part of the shipped route tree; this shim is the only thing in `app/`. In a
 * production build `__DEV__` is false, so it renders a redirect and — because the
 * `require`s sit in the dead branch that minification drops — the story code and
 * its fixtures are left out of the bundle entirely.
 */
export default function StoriesRoute() {
  const [tab, setTab] = useState<'heatmap' | 'feedback'>('heatmap');

  if (!__DEV__) return <Redirect href="/" />;

  // Intentional require()s so the story code stays out of production bundles.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const HeatmapStories = require('@/stories/HeatmapStories').default;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const FeedbackStories = require('@/stories/FeedbackStories').default;

  return (
    <View style={styles.container}>
      <View style={styles.tabs}>
        {(['heatmap', 'feedback'] as const).map((name) => (
          <Pressable
            key={name}
            onPress={() => setTab(name)}
            style={[styles.tab, tab === name && styles.tabActive]}
          >
            <Text style={[styles.tabText, tab === name && styles.tabTextActive]}>
              {name}
            </Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.body}>
        {tab === 'heatmap' ? <HeatmapStories /> : <FeedbackStories />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  tabs: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 60,
    paddingBottom: 8,
  },
  tab: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#f0ecf9',
  },
  tabActive: { backgroundColor: '#aa88f1' },
  tabText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#7c6ba0',
    textTransform: 'capitalize',
  },
  tabTextActive: { color: '#fff' },
  body: { flex: 1 },
});
