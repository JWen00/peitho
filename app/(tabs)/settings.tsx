import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { supabase } from '@/lib/supabase';
import { MAX_TALKING_MINUTES, MIN_TALKING_MINUTES, useSettings } from '@/lib/settings';

const TALKING_OPTIONS = Array.from(
  { length: MAX_TALKING_MINUTES - MIN_TALKING_MINUTES + 1 },
  (_, i) => MIN_TALKING_MINUTES + i,
);

export default function SettingsScreen() {
  const { talkingMinutes, setTalkingMinutes } = useSettings();

  async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) Alert.alert('Error', error.message);
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

      <TouchableOpacity style={styles.signOut} onPress={signOut}>
        <Text style={styles.signOutText}>Sign out</Text>
      </TouchableOpacity>
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
  signOut: {
    marginTop: 'auto',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  signOutText: { fontSize: 16, color: '#c0392b' },
});
