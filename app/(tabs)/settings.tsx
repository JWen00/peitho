import { useState } from 'react';
import {
  Alert,
  Platform,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { MAX_TALKING_MINUTES, MIN_TALKING_MINUTES, useSettings } from '@/lib/settings';
import { type ReminderTime, useNotificationSettings } from '@/lib/notifications';

const TALKING_OPTIONS = Array.from(
  { length: MAX_TALKING_MINUTES - MIN_TALKING_MINUTES + 1 },
  (_, i) => MIN_TALKING_MINUTES + i,
);

function formatTime({ hour, minute }: ReminderTime): string {
  const period = hour < 12 ? 'AM' : 'PM';
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${displayHour}:${String(minute).padStart(2, '0')} ${period}`;
}

function timeToDate({ hour, minute }: ReminderTime): Date {
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  return date;
}

export default function SettingsScreen() {
  const { talkingMinutes, setTalkingMinutes } = useSettings();
  const { enabled, time, setEnabled, setTime } = useNotificationSettings();
  const [pickerOpen, setPickerOpen] = useState(false);
  const router = useRouter();

  async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) Alert.alert('Error', error.message);
  }

  async function toggleNotifications(next: boolean) {
    const granted = await setEnabled(next);
    if (next && !granted) {
      Alert.alert(
        'Notifications disabled',
        'Turn on notifications for Peitho in your device settings to get a daily reminder.',
      );
    }
    if (!next) setPickerOpen(false);
  }

  // Android's picker is a self-dismissing system dialog; iOS's spinner stays
  // open until "Done" is tapped, so only Android closes itself here.
  function onTimeChange(event: DateTimePickerEvent, selected?: Date) {
    if (Platform.OS === 'android') setPickerOpen(false);
    if (event.type === 'dismissed' || !selected) return;
    setTime({ hour: selected.getHours(), minute: selected.getMinutes() });
  }

  return (
    <View style={styles.container}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Talking time</Text>
        <Text style={styles.sectionHint}>How long you get to speak on each topic.</Text>
        <View style={styles.options}>
          {TALKING_OPTIONS.map((minutes) => {
            const selected = minutes === talkingMinutes;
            return (
              <TouchableOpacity
                key={minutes}
                style={[styles.option, selected && styles.optionSelected]}
                onPress={() => setTalkingMinutes(minutes)}
                accessibilityRole="button"
                accessibilityState={{ selected }}
              >
                <Text style={[styles.optionText, selected && styles.optionTextSelected]}>
                  {minutes} min
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <View style={styles.section}>
        <View style={styles.row}>
          <View style={styles.rowText}>
            <Text style={styles.sectionTitle}>Daily reminder</Text>
            <Text style={styles.sectionHint}>Get nudged once a day to do your talk.</Text>
          </View>
          <Switch value={enabled} onValueChange={toggleNotifications} />
        </View>

        {enabled && (
          <TouchableOpacity
            style={styles.timeButton}
            onPress={() => setPickerOpen(true)}
            accessibilityRole="button"
          >
            <Text style={styles.timeButtonText}>{formatTime(time)}</Text>
          </TouchableOpacity>
        )}

        {enabled && pickerOpen && (
          <DateTimePicker
            value={timeToDate(time)}
            mode="time"
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            onChange={onTimeChange}
          />
        )}

        {enabled && pickerOpen && Platform.OS === 'ios' && (
          <TouchableOpacity
            style={styles.doneButton}
            onPress={() => setPickerOpen(false)}
            accessibilityRole="button"
          >
            <Text style={styles.doneButtonText}>Done</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.footer}>
        {__DEV__ && (
          <TouchableOpacity
            style={styles.storiesButton}
            onPress={() => router.push('/stories')}
          >
            <Text style={styles.storiesButtonText}>View stories (dev)</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity style={styles.signOut} onPress={signOut}>
          <Text style={styles.signOutText}>Sign out</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, backgroundColor: '#fff' },
  section: { marginBottom: 40 },
  sectionTitle: { fontSize: 17, fontWeight: '600', color: '#333' },
  sectionHint: { fontSize: 14, color: '#888', marginTop: 4, marginBottom: 16 },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  option: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 18,
    minWidth: 64,
    alignItems: 'center',
  },
  optionSelected: { backgroundColor: '#333', borderColor: '#333' },
  optionText: { fontSize: 16, color: '#333' },
  optionTextSelected: { color: '#fff', fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowText: { flex: 1, marginRight: 12 },
  timeButton: {
    marginTop: 16,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  timeButtonText: { fontSize: 16, color: '#333', fontWeight: '600' },
  doneButton: { marginTop: 8, alignItems: 'center', paddingVertical: 8 },
  doneButtonText: { fontSize: 15, color: '#333', fontWeight: '600' },
  footer: { marginTop: 'auto', gap: 12 },
  storiesButton: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  storiesButtonText: { fontSize: 16, color: '#333' },
  signOut: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  signOutText: { fontSize: 16, color: '#c0392b' },
});
