import AsyncStorage from '@react-native-async-storage/async-storage';

// Non-sensitive app preferences (talking time, daily-reminder settings).
// AsyncStorage is one cross-platform key-value store — native-backed on
// iOS/Android and localStorage-backed on web — so no Platform split is needed.
// Secrets (auth tokens) live in SecureStore via lib/supabase.ts, not here.
export async function readValue(key: string): Promise<string | null> {
  return AsyncStorage.getItem(key);
}

export async function writeValue(key: string, value: string): Promise<void> {
  await AsyncStorage.setItem(key, value);
}

export async function deleteValue(key: string): Promise<void> {
  await AsyncStorage.removeItem(key);
}
