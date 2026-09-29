import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

import { deleteValue, readValue, writeValue } from './storage';

export const DEFAULT_REMINDER_HOUR = 19;
export const DEFAULT_REMINDER_MINUTE = 0;

const ENABLED_KEY = 'daily_reminder_enabled';
const HOUR_KEY = 'daily_reminder_hour';
const MINUTE_KEY = 'daily_reminder_minute';
// The id scheduleNotificationAsync hands back, so a later reschedule can
// cancel the exact trigger it's replacing instead of cancelling everything.
const NOTIFICATION_ID_KEY = 'daily_reminder_notification_id';

// Local-only reminder, so the only behavior that matters is a banner while
// the app happens to be open; no sound or badge for a "go talk" nudge.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export interface ReminderTime {
  hour: number;
  minute: number;
}

function clampTime({ hour, minute }: ReminderTime): ReminderTime {
  return {
    hour: Math.min(23, Math.max(0, Math.round(hour))),
    minute: Math.min(59, Math.max(0, Math.round(minute))),
  };
}

async function hasPermission(): Promise<boolean> {
  const settings = await Notifications.getPermissionsAsync();
  return (
    settings.granted ||
    settings.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL
  );
}

async function requestPermission(): Promise<boolean> {
  if (await hasPermission()) return true;
  const settings = await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowBadge: true, allowSound: true },
  });
  return (
    settings.granted ||
    settings.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL
  );
}

/** Replaces any previously scheduled reminder with one at the given time. */
async function scheduleDailyReminder(time: ReminderTime): Promise<void> {
  const previousId = await readValue(NOTIFICATION_ID_KEY);
  if (previousId) {
    await Notifications.cancelScheduledNotificationAsync(previousId).catch(() => {});
  }

  if (Platform.OS === 'android') {
    // Android 8+ routes notifications through a channel; without one the
    // reminder is silently dropped instead of shown with defaults.
    await Notifications.setNotificationChannelAsync('daily-reminder', {
      name: 'Daily reminder',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  const id = await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Time for your daily talk',
      body: 'Keep your streak going — pick a topic and speak for a few minutes.',
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour: time.hour,
      minute: time.minute,
    },
  });
  await writeValue(NOTIFICATION_ID_KEY, id);
}

async function cancelDailyReminder(): Promise<void> {
  const previousId = await readValue(NOTIFICATION_ID_KEY);
  if (!previousId) return;
  await Notifications.cancelScheduledNotificationAsync(previousId).catch(() => {});
  await deleteValue(NOTIFICATION_ID_KEY);
}

interface NotificationSettingsValue {
  enabled: boolean;
  time: ReminderTime;
  /** Resolves false, leaving `enabled` off, if the user denies the OS prompt. */
  setEnabled: (enabled: boolean) => Promise<boolean>;
  setTime: (time: ReminderTime) => void;
}

const NotificationSettingsContext = createContext<NotificationSettingsValue | null>(null);

export function NotificationSettingsProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabledState] = useState(false);
  const [time, setTimeState] = useState<ReminderTime>({
    hour: DEFAULT_REMINDER_HOUR,
    minute: DEFAULT_REMINDER_MINUTE,
  });

  useEffect(() => {
    (async () => {
      const [storedEnabled, storedHour, storedMinute] = await Promise.all([
        readValue(ENABLED_KEY),
        readValue(HOUR_KEY),
        readValue(MINUTE_KEY),
      ]);
      if (storedHour !== null && storedMinute !== null) {
        setTimeState(
          clampTime({ hour: Number(storedHour), minute: Number(storedMinute) }),
        );
      }
      // Re-check the OS permission rather than trusting the stored flag — the
      // user may have revoked it from system settings since it was last set.
      const stillGranted = storedEnabled === '1' && (await hasPermission());
      setEnabledState(stillGranted);
      if (storedEnabled === '1' && !stillGranted) void writeValue(ENABLED_KEY, '0');
    })().catch(() => {});
  }, []);

  const setTime = useCallback(
    (next: ReminderTime) => {
      const clamped = clampTime(next);
      setTimeState(clamped);
      void writeValue(HOUR_KEY, String(clamped.hour)).catch(() => {});
      void writeValue(MINUTE_KEY, String(clamped.minute)).catch(() => {});
      if (enabled) void scheduleDailyReminder(clamped).catch(() => {});
    },
    [enabled],
  );

  const setEnabled = useCallback(
    async (next: boolean) => {
      if (next) {
        const granted = await requestPermission();
        if (!granted) return false;
        await scheduleDailyReminder(time);
      } else {
        await cancelDailyReminder();
      }
      setEnabledState(next);
      void writeValue(ENABLED_KEY, next ? '1' : '0').catch(() => {});
      return next;
    },
    [time],
  );

  return createElement(
    NotificationSettingsContext.Provider,
    { value: { enabled, time, setEnabled, setTime } },
    children,
  );
}

export function useNotificationSettings(): NotificationSettingsValue {
  const value = useContext(NotificationSettingsContext);
  if (!value) {
    throw new Error(
      'useNotificationSettings must be used within a NotificationSettingsProvider',
    );
  }
  return value;
}
