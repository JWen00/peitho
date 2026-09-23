import { useFonts } from 'expo-font';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import 'react-native-reanimated';
import type { Session } from '@supabase/supabase-js';

import * as Linking from 'expo-linking';

import { createSessionFromUrl, supabase } from '@/lib/supabase';

export { ErrorBoundary } from 'expo-router';

SplashScreen.preventAutoHideAsync();

function useAuthGuard(session: Session | null, ready: boolean) {
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (!ready) return;
    const inAuth = segments[0] === '(auth)';
    // The dev-only story gallery has no account behind it; let it open signed
    // out. `__DEV__` keeps this exemption out of production entirely.
    const inDevStories = __DEV__ && segments[0] === 'stories';
    if (!session && !inAuth && !inDevStories) {
      router.replace('/(auth)');
    } else if (session && inAuth) {
      router.replace('/(tabs)');
    }
  }, [session, ready, segments]);
}

export default function RootLayout() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
  });

  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setReady(true);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  // The email-confirmation link reopens the app with tokens in the URL.
  // onAuthStateChange then fires and the guard moves us into (tabs).
  const url = Linking.useLinkingURL();
  useEffect(() => {
    if (url) createSessionFromUrl(url).catch(() => {});
  }, [url]);

  useEffect(() => {
    if (loaded && ready) SplashScreen.hideAsync();
  }, [loaded, ready]);

  useAuthGuard(session, ready);

  if (!loaded || !ready) return null;

  return (
    <Stack>
      <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="session/[id]" options={{ title: 'Session', presentation: 'card' }} />
    </Stack>
  );
}
