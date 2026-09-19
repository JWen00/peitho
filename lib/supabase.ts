import 'react-native-url-polyfill/auto';
import { Platform } from 'react-native';
import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { Database } from './database.types';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

// expo-secure-store is native-only. On web its native module resolves to an
// empty object, so any call into it throws. Use localStorage there, guarded for
// static web rendering, which evaluates this module in Node with no window.
const WebStorageAdapter = {
  getItem: async (key: string) =>
    typeof localStorage === 'undefined' ? null : localStorage.getItem(key),
  setItem: async (key: string, value: string) => {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
  },
  removeItem: async (key: string) => {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(key);
  },
};

const ExpoSecureStoreAdapter = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: Platform.OS === 'web' ? WebStorageAdapter : ExpoSecureStoreAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: Platform.OS === 'web',
  },
});

/**
 * Supabase returns auth tokens in the URL *fragment* (implicit flow), which
 * Linking.parse() does not read, so pull params from both halves.
 */
function parseAuthParams(url: string): Record<string, string> {
  const params: Record<string, string> = {};
  for (const part of [url.split('#')[1], url.split('#')[0].split('?')[1]]) {
    if (!part) continue;
    for (const [k, v] of new URLSearchParams(part).entries()) params[k] ??= v;
  }
  return params;
}

/**
 * Turns the emailed confirmation link into a signed-in session. On web,
 * detectSessionInUrl already does this, so it is a no-op there.
 */
export async function createSessionFromUrl(url: string) {
  const params = parseAuthParams(url);
  if (params.error_description) throw new Error(params.error_description);

  const { access_token, refresh_token } = params;
  if (!access_token || !refresh_token) return null;

  const { data, error } = await supabase.auth.setSession({ access_token, refresh_token });
  if (error) throw error;
  return data.session;
}
