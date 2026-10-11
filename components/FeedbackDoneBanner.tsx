import * as Haptics from 'expo-haptics';
import { usePathname, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { onFeedbackFinished, type FeedbackFinished } from '@/lib/feedbackJobs';

const BRAND = '#aa88f1';

/** Long enough to notice and read; tapping or swiping it away is quicker. */
const VISIBLE_MS = 6000;

/**
 * App-wide "your feedback is ready" alert.
 *
 * Feedback runs keep going after the user leaves the talk (see
 * `lib/feedbackJobs`), so when one ends they are usually somewhere else. This
 * drops a banner over whatever screen they are on; tapping it opens the talk.
 * Skipped when they are already on that talk — the result appears there itself.
 */
export default function FeedbackDoneBanner() {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const [event, setEvent] = useState<FeedbackFinished | null>(null);

  // Read inside the listener without resubscribing on every navigation.
  const pathnameRef = useRef(pathname);
  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  useEffect(
    () =>
      onFeedbackFinished((finished) => {
        if (pathnameRef.current === `/session/${finished.talkId}`) return;
        setEvent(finished);
        void Haptics.notificationAsync(
          finished.outcome === 'ready'
            ? Haptics.NotificationFeedbackType.Success
            : finished.outcome === 'partial'
              ? Haptics.NotificationFeedbackType.Warning
              : Haptics.NotificationFeedbackType.Error,
        ).catch(() => {});
      }),
    [],
  );

  // Restarts per event, so a second run finishing shows for its full time.
  useEffect(() => {
    if (!event) return;
    const id = setTimeout(() => setEvent(null), VISIBLE_MS);
    return () => clearTimeout(id);
  }, [event]);

  // Reaching the talk by another route also makes the banner moot.
  if (!event || pathname === `/session/${event.talkId}`) return null;

  const ready = event.outcome === 'ready';
  const partial = event.outcome === 'partial';

  return (
    <Animated.View
      key={`${event.talkId}-${event.outcome}`}
      entering={FadeInUp}
      exiting={FadeOutUp}
      style={[styles.wrap, { top: insets.top + 8 }]}
      pointerEvents="box-none"
    >
      <Pressable
        style={({ pressed }) => [styles.banner, pressed && styles.pressed]}
        onPress={() => {
          setEvent(null);
          router.push(`/session/${event.talkId}`);
        }}
        accessibilityRole="button"
        accessibilityLiveRegion="polite"
        accessibilityLabel={`${ready ? 'Feedback ready' : partial ? 'Feedback partly finished' : 'Feedback failed'} for ${event.topic}. Open talk.`}
      >
        <View style={[styles.dot, !ready && styles.dotError]}>
          <Text style={styles.dotText}>{ready ? '✓' : '!'}</Text>
        </View>
        <View style={styles.body}>
          <Text style={styles.title}>
            {ready
              ? 'Your feedback is ready'
              : partial
                ? 'Feedback partly finished'
                : 'Feedback didn’t finish'}
          </Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {ready
              ? event.topic
              : partial
                ? `Tap to continue · ${event.topic}`
                : `Tap to try again · ${event.topic}`}
          </Text>
        </View>
        <Text style={styles.chevron}>›</Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 16, right: 16, zIndex: 1000 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  pressed: { opacity: 0.85 },
  dot: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: BRAND,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotError: { backgroundColor: '#c0392b' },
  dotText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  body: { flex: 1 },
  title: { fontSize: 15, fontWeight: '600', color: '#222' },
  subtitle: { fontSize: 13, color: '#888', marginTop: 2 },
  chevron: { fontSize: 22, color: '#bbb' },
});
