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
| Android | Android SDK + an AVD, **JDK 17 exactly** (not 21 — see note below) |
| Both | Node, `npm install` already run, a running local Supabase stack |

Environment variables — put these in your `~/.zshrc`:

```bash
export LANG=en_US.UTF-8
export ANDROID_HOME=$HOME/Library/Android/sdk
export PATH=$PATH:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator
```

`LANG` is not optional. With no UTF-8 locale, Ruby reports a `US-ASCII` filesystem encoding and `pod install` dies with `Unicode Normalization not appropriate for ASCII-8BIT` before the iOS build starts.

Supabase credentials go in `.env.local` (gitignored). Copy the template and
fill it from the values `supabase start` prints (or the hosted dashboard):

```bash
cp .env.example .env.local
```

```
EXPO_PUBLIC_SUPABASE_URL=...
EXPO_PUBLIC_SUPABASE_ANON_KEY=...
```

### Local backend (Supabase)

The app needs a running Supabase stack. This machine runs it on **Colima, not
Docker Desktop** — install both with `brew install colima docker` (Colima ships
no docker client), then start the VM with enough headroom (the 2 CPU / 2 GB
default is too small):

```bash
colima start --cpu 4 --memory 8
```

The Supabase CLI does not reliably follow Docker *contexts*, so point it at the
Colima socket directly. Add this to `~/.zshrc` so every shell has it:

```bash
export DOCKER_HOST="unix://$HOME/.colima/default/docker.sock"
```

Without it, `supabase start` fails with a misleading "docker: command not found"
that reads like Colima is down. Then start the stack and load schema + seed:

```bash
npm run db:start    # supabase start
npm run db:reset    # apply migrations + seed.sql into a fresh local DB
```

`db:start` prints the API URL, anon key, and dashboard links. Local ports:
API `54321`, Postgres `54322`, Studio `54323`, inbound email `54324`.

To run edge functions locally (e.g. `talks`):

```bash
npm run functions:serve
```

Once the stack is up, `npm run dev` boots it (idempotent) and Metro in one go.

**If `supabase start` dies with `network supabase_network_peitho not found`** —
a stale network from an interrupted first boot. Reset it:

```bash
npm run db:stop -- --no-backup && npm run db:start
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

Once the dev build is installed, you do not need to rebuild to see JS changes. With the Supabase stack up, just start Metro:

```bash
npm start          # expo start
```

Or `npm run dev` to bring the local stack up (idempotent) and start Metro together.

Press `i` to open iOS, `a` for Android, `r` to reload, `j` to open the debugger. Fast Refresh picks up edits under `app/` automatically.

Rebuild natively (`expo run:*`) only when you add a native dependency, change `app.json` plugins, or edit anything under `ios/` or `android/`.

### Code quality

Static checks — these run in CI (`.github/workflows/ci.yml`) on every push and PR, and are worth running before you push:

```bash
npm run typecheck      # tsc --noEmit
npm run lint           # eslint (eslint-config-expo)
npm run format:check   # prettier --check
```

Fixers: `npm run lint:fix` and `npm run format`. Edge functions (Deno, not covered by the above) have their own gate: `npm run functions:check` (`deno lint` + `fmt --check` + `check`).

### Troubleshooting

**`Unicode Normalization not appropriate for ASCII-8BIT`** during `pod install` — `LANG` is unset. Export it as above, then:

```bash
cd ios && pod install
```

**`The sandbox is not in sync with the Podfile.lock`** — a failed `pod install` left the project stale. Fix the underlying error, rerun `pod install`, then rebuild.

**`Failed to resolve the Android SDK path`** — `ANDROID_HOME` is unset or points somewhere wrong.

**`Could not initialize class org.gradle.toolchains.foojay.DistributionsKt`** / `NoSuchFieldError ... IBM_SEMERU`** during an Android build — no JDK 17 present. The Gradle plugin requires JDK **17 exactly** (not 21); with it missing, Gradle falls back to a pinned foojay resolver that crashes on Gradle 9. Install Zulu 17 and point `JAVA_HOME` at it — don't try to patch the resolver.

**`docker: command not found` / can't connect to Docker** when running `supabase` — `DOCKER_HOST` isn't exported. See [Local backend](#local-backend-supabase).

**No booted simulator / no devices listed** — the iOS runtime is missing. See the iOS section above.

To start over from a clean native state:

```bash
rm -rf ios android && npx expo prebuild
```

`ios/` and `android/` are generated and gitignored; deleting them is safe.
