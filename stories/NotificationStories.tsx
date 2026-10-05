import { Stack } from 'expo-router';
import { useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import * as Notifications from 'expo-notifications';

import { requestNotificationPermission } from '@/lib/notifications';

/**
 * A dev-only harness for sanity-checking local notifications end to end:
 * fire one immediately, and schedule one 10 seconds out to prove the timed
 * path actually delivers. Lives outside `app/` so it never ships — see the
 * `__DEV__` shim at `app/stories/notifications.tsx`.
 *
 * The app's notification handler (lib/notifications.ts) returns
 * `shouldShowBanner: true`, so both fire as a banner even with the app in the
 * foreground — no need to background the app to see them.
 */

const TEST_CHANNEL = 'dev-test';

async function ensureAndroidChannel() {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(TEST_CHANNEL, {
      name: 'Dev test',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
}

export default function NotificationStories() {
  const [status, setStatus] = useState('Send a test notification to check delivery.');

  async function send(delaySeconds: number) {
    if (!(await requestNotificationPermission())) {
      setStatus('Permission denied — enable notifications for Peitho in Settings.');
      return;
    }
    await ensureAndroidChannel();
    await Notifications.scheduleNotificationAsync({
      content: {
        title: delaySeconds === 0 ? 'Immediate test' : 'Timed test',
        body:
          delaySeconds === 0
            ? 'This notification fired right away.'
            : `This was scheduled ${delaySeconds} seconds ago.`,
      },
      // A null trigger fires immediately; a TIME_INTERVAL trigger fires after
      // the given delay — the one-shot analogue of the daily reminder.
      trigger:
        delaySeconds === 0
          ? null
          : {
              type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
              seconds: delaySeconds,
              repeats: false,
            },
    });
    setStatus(
      delaySeconds === 0
        ? 'Sent an immediate notification.'
        : `Scheduled a notification for ${delaySeconds}s from now.`,
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Notification stories' }} />
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <Text style={styles.blurb}>
          Fire a local notification now, or in 10 seconds to confirm the timed path
          delivers.
        </Text>

        <Pressable style={styles.button} onPress={() => send(0)}>
          <Text style={styles.buttonText}>Send now</Text>
        </Pressable>

        <Pressable style={styles.button} onPress={() => send(10)}>
          <Text style={styles.buttonText}>Send in 10 seconds</Text>
        </Pressable>

        <Text style={styles.status}>{status}</Text>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 20, gap: 12 },
  blurb: { fontSize: 13, color: '#888', lineHeight: 19, marginBottom: 4 },
  button: {
    backgroundColor: '#6031c4',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  status: { fontSize: 13, color: '#555', lineHeight: 19, marginTop: 8 },
});
