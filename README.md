# Peitho

Daily impromptu-speaking practice. Get a random topic, plan for 2 minutes, record for 1 minute, get a transcript.

Built with React Native + Expo (SDK 56) and Supabase. See [project.md](project.md) for the full build plan.

---

## Local testing

Peitho uses native modules (`expo-audio`, `expo-speech-recognition`), so **it cannot run in Expo Go**. You need a development build compiled onto a simulator or emulator.

### Prerequisites

| Target | Needs |
|---|---|
| iOS | Xcode + an iOS simulator runtime, CocoaPods |
| Android | Android SDK + an AVD, JDK 17+ |
| Both | Node, `npm install` already run |

Environment variables — put these in your `~/.zshrc`:

```bash
export LANG=en_US.UTF-8
export ANDROID_HOME=$HOME/Library/Android/sdk
export PATH=$PATH:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator
```

`LANG` is not optional. With no UTF-8 locale, Ruby reports a `US-ASCII` filesystem encoding and `pod install` dies with `Unicode Normalization not appropriate for ASCII-8BIT` before the iOS build starts.

Supabase credentials go in `.env.local` (gitignored):

```
EXPO_PUBLIC_SUPABASE_URL=...
EXPO_PUBLIC_SUPABASE_ANON_KEY=...
```

### iOS

Confirm a simulator runtime is installed:

```bash
xcrun simctl list runtimes
```

If that prints nothing under `== Runtimes ==`, download one (~9 GB, prompts for your admin password):

```bash
xcodebuild -downloadPlatform iOS
```

Then build, install, and launch:

```bash
npx expo run:ios
```

To pick a specific device instead of the default:

```bash
npx expo run:ios --device "iPhone 17 Pro"
```

The first run generates the native `ios/` directory, installs ~100 pods, and compiles from scratch — budget 10–15 minutes. Later runs are incremental.

### Android

List your virtual devices:

```bash
emulator -list-avds
```

Start one (create one in Android Studio's Device Manager if the list is empty):

```bash
emulator -avd Pixel_10_Pro_Fold
```

Then, with the emulator booted:

```bash
npx expo run:android
```

### Web

```bash
npx expo start --web
```

Useful for layout work only. `expo-audio` and `expo-speech-recognition` are native-only, so recording and transcription do not function on web.

### Day to day

Once the dev build is installed, you do not need to rebuild to see JS changes. Just start Metro:

```bash
npx expo start
```

Press `i` to open iOS, `a` for Android, `r` to reload, `j` to open the debugger. Fast Refresh picks up edits under `app/` automatically.

Rebuild natively (`expo run:*`) only when you add a native dependency, change `app.json` plugins, or edit anything under `ios/` or `android/`.

### Troubleshooting

**`Unicode Normalization not appropriate for ASCII-8BIT`** during `pod install` — `LANG` is unset. Export it as above, then:

```bash
cd ios && pod install
```

**`The sandbox is not in sync with the Podfile.lock`** — a failed `pod install` left the project stale. Fix the underlying error, rerun `pod install`, then rebuild.

**`Failed to resolve the Android SDK path`** — `ANDROID_HOME` is unset or points somewhere wrong.

**No booted simulator / no devices listed** — the iOS runtime is missing. See the iOS section above.

To start over from a clean native state:

```bash
rm -rf ios android && npx expo prebuild
```

`ios/` and `android/` are generated and gitignored; deleting them is safe.
