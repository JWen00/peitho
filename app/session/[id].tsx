import { useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

export default function SessionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  return (
    <View style={styles.container}>
      <Text style={styles.label}>Session</Text>
      <Text style={styles.id}>{id}</Text>
      <Text style={styles.sub}>Detail view — coming in Phase 3</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32, backgroundColor: '#fff' },
  label: { fontSize: 13, color: '#888', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 },
  id: { fontSize: 14, fontFamily: 'SpaceMono', color: '#333', marginBottom: 24 },
  sub: { fontSize: 15, color: '#888' },
});
