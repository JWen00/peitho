import { Link, Redirect, Stack } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

/**
 * Dev-only menu of story galleries. Each entry is its own route under
 * `app/stories/`, guarded by `__DEV__` so the story code and fixtures drop out
 * of a production bundle (see the shims alongside this file).
 */
export default function StoriesIndex() {
  if (!__DEV__) return <Redirect href="/" />;

  return (
    <>
      <Stack.Screen options={{ title: 'Stories' }} />
      <View style={styles.container}>
        <Link href="/stories/notifications" style={styles.row}>
          <Text style={styles.rowText}>Notifications</Text>
        </Link>
        <Link href="/stories/heatmap" style={styles.row}>
          <Text style={styles.rowText}>Heatmap</Text>
        </Link>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', padding: 20, gap: 12 },
  row: {
    borderWidth: 1,
    borderColor: '#eee',
    borderRadius: 12,
    paddingVertical: 18,
    paddingHorizontal: 16,
  },
  rowText: { fontSize: 16, color: '#333', fontWeight: '500' },
});
