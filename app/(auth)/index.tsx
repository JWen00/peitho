import { useEffect, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { createSessionFromUrl, supabase } from '@/lib/supabase';

/** Brand purple, taken from the logo. Reused for every accent on this screen. */
const BRAND = '#aa88f1';

const logo = require('../../assets/images/auth-logo.webp');
const floralBackground = require('../../assets/images/auth-bg.webp');

export default function AuthScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  // Alert.alert is a no-op on react-native-web, so messages render inline.
  const [notice, setNotice] = useState<{ kind: 'error' | 'info'; text: string } | null>(
    null,
  );

  async function handleSubmit() {
    setLoading(true);
    setNotice(null);

    if (mode === 'signin') {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      setLoading(false);
      if (error) setNotice({ kind: 'error', text: error.message });
      return;
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: Linking.createURL('/') },
    });
    setLoading(false);

    if (error) {
      setNotice({ kind: 'error', text: error.message });
      return;
    }

    // With email confirmation on, signUp succeeds but returns no session: the
    // account is not usable until the emailed link is clicked.
    if (!data.session) {
      setNotice({
        kind: 'info',
        text: `Account created. Check ${email} for a confirmation link, then sign in.`,
      });
      setMode('signin');
    }
  }

  // OAuth on native is a round trip through the system browser: Supabase hands
  // back an authorize URL, we open it, and the provider redirects to our app
  // scheme with the tokens in the fragment — the same shape the email link uses,
  // so `createSessionFromUrl` finishes the sign-in.
  async function handleGoogle() {
    setGoogleLoading(true);
    setNotice(null);
    try {
      const redirectTo = Linking.createURL('/');
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo, skipBrowserRedirect: true },
      });
      if (error) throw error;
      if (!data.url) throw new Error('Could not start Google sign-in.');

      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
      // 'cancel'/'dismiss' means the user backed out — not an error to surface.
      if (result.type === 'success') await createSessionFromUrl(result.url);
    } catch (error) {
      setNotice({
        kind: 'error',
        text: error instanceof Error ? error.message : 'Google sign-in failed.',
      });
    } finally {
      setGoogleLoading(false);
    }
  }

  const busy = loading || googleLoading;

  // The background drifts slowly to feel alive, but motion is an accessibility
  // concern: honour the OS "Reduce Motion" setting (the platform's disable-
  // animation signal) and hold it still when that is on.
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (active) setReduceMotion(enabled);
    });
    const sub = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduceMotion,
    );
    return () => {
      active = false;
      sub.remove();
    };
  }, []);

  const [drift] = useState(() => new Animated.Value(0.5));
  useEffect(() => {
    if (reduceMotion) {
      drift.stopAnimation();
      drift.setValue(0.5); // Centred, so the image sits still with no offset.
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(drift, {
          toValue: 1,
          duration: 11000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(drift, {
          toValue: 0,
          duration: 11000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [reduceMotion, drift]);

  // Scaled up so the pan never exposes an edge; the offsets stay well inside it.
  const backgroundTransform = {
    transform: [
      { scale: 1.25 },
      { translateX: drift.interpolate({ inputRange: [0, 1], outputRange: [-26, 26] }) },
      { translateY: drift.interpolate({ inputRange: [0, 1], outputRange: [18, -18] }) },
    ],
  };

  return (
    <View style={styles.background}>
      <Animated.Image
        source={floralBackground}
        resizeMode="cover"
        blurRadius={6}
        style={[styles.backgroundImage, backgroundTransform]}
      />
      <View style={styles.overlay} />
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.card}>
          <Image source={logo} style={styles.logo} resizeMode="contain" />
          <Text style={styles.title}>Peitho</Text>
          <Text style={styles.subtitle}>Daily impromptu speaking practice</Text>

          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor="#a99cc4"
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
          />
          <TextInput
            style={styles.input}
            placeholder="Password"
            placeholderTextColor="#a99cc4"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />

          {notice && (
            <Text
              style={[
                styles.notice,
                notice.kind === 'error' ? styles.noticeError : styles.noticeInfo,
              ]}
            >
              {notice.text}
            </Text>
          )}

          <TouchableOpacity
            style={[styles.button, busy && styles.buttonDisabled]}
            onPress={handleSubmit}
            disabled={busy}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>
                {mode === 'signin' ? 'Sign in' : 'Sign up'}
              </Text>
            )}
          </TouchableOpacity>

          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>or</Text>
            <View style={styles.dividerLine} />
          </View>

          <TouchableOpacity
            style={[styles.googleButton, busy && styles.buttonDisabled]}
            onPress={handleGoogle}
            disabled={busy}
          >
            {googleLoading ? (
              <ActivityIndicator color={BRAND} />
            ) : (
              <Text style={styles.googleButtonText}>Continue with Google</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => setMode(mode === 'signin' ? 'signup' : 'signin')}
          >
            <Text style={styles.toggle}>
              {mode === 'signin' ? (
                <>
                  Don&apos;t have an account?{' '}
                  <Text style={styles.toggleAccent}>Sign up</Text>
                </>
              ) : (
                <>
                  Already have an account?{' '}
                  <Text style={styles.toggleAccent}>Sign in</Text>
                </>
              )}
            </Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  // Fallback lilac matches the floral wash, so the screen is on-brand before the
  // image decodes and wherever it does not fully cover.
  background: { flex: 1, backgroundColor: '#e8dbf7', overflow: 'hidden' },
  backgroundImage: { position: 'absolute', width: '100%', height: '100%' },
  // A translucent dark-purple wash over the background: deepens the colour so
  // the white card and title lift off it.
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(59, 47, 102, 0.4)',
  },
  container: { flex: 1, justifyContent: 'center', paddingHorizontal: 24 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 28,
    paddingHorizontal: 28,
    paddingTop: 32,
    paddingBottom: 28,
    alignSelf: 'center',
    maxWidth: 440,
    width: '100%',
    // Lifts the card off the busy grid on both platforms.
    shadowColor: '#4b2e83',
    shadowOpacity: 0.18,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 8,
  },
  // Peitho's circular logo. borderRadius keeps the drop shadow circular too.
  logo: {
    width: 112,
    height: 112,
    borderRadius: 56,
    alignSelf: 'center',
    marginBottom: 14,
    shadowColor: '#4b2e83',
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
  },
  title: {
    fontSize: 36,
    fontWeight: '700',
    textAlign: 'center',
    color: '#3d2f66',
    marginBottom: 6,
  },
  subtitle: { fontSize: 15, color: '#8778a6', textAlign: 'center', marginBottom: 32 },
  input: {
    borderWidth: 1,
    borderColor: '#e4d9f6',
    backgroundColor: '#faf7ff',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: '#2f2450',
    marginBottom: 12,
  },
  button: {
    backgroundColor: BRAND,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
    shadowColor: BRAND,
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  divider: { flexDirection: 'row', alignItems: 'center', marginVertical: 18 },
  dividerLine: { flex: 1, height: 1, backgroundColor: '#eadff8' },
  dividerText: { marginHorizontal: 12, fontSize: 13, color: '#a99cc4' },
  googleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e0d3f4',
    borderRadius: 12,
    paddingVertical: 15,
    marginBottom: 20,
  },
  googleButtonText: { color: '#4a3a72', fontSize: 16, fontWeight: '600' },
  toggle: { textAlign: 'center', color: '#8778a6', fontSize: 14 },
  toggleAccent: { color: BRAND, fontWeight: '600' },
  notice: { fontSize: 14, lineHeight: 20, marginBottom: 4, marginTop: 4 },
  noticeError: { color: '#b3261e' },
  noticeInfo: { color: '#5a3fb0' },
});
