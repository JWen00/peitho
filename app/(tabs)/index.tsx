import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

export default function PracticeScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.label}>Today's topic</Text>
      <Text style={styles.topic}>Placeholder topic — coming in Phase 2</Text>
      <TouchableOpacity style={styles.button} disabled>
        <Text style={styles.buttonText}>Start planning (2:00)</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32, backgroundColor: '#fff' },
  label: { fontSize: 13, color: '#888', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 16 },
  topic: { fontSize: 24, fontWeight: '600', textAlign: 'center', marginBottom: 48, lineHeight: 32 },
  button: {
    backgroundColor: '#333',
    borderRadius: 14,
    paddingVertical: 18,
    paddingHorizontal: 40,
    opacity: 0.4,
  },
  buttonText: { color: '#fff', fontSize: 17, fontWeight: '600' },
});
