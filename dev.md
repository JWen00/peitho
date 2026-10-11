# Developing Peitho locally

A quick path from a fresh clone to a running app, plus the things that trip people up. [README.md](README.md) has the long-form setup and troubleshooting; [project.md](project.md) has the architecture.

Peitho uses native modules (`expo-audio`, `expo-speech-recognition`, `expo-ai-kit`), so it **cannot run in Expo Go**. You need a development build on a simulator, emulator or device.

## 1. One-time machine setup

You need Node 20+, Xcode (iOS) or Android Studio with **JDK 17 exactly** (Android), CocoaPods, [Supabase CLI](https://supabase.com/docs/guides/cli), [Deno 2](https://deno.com) (for edge-function checks), and Colima plus the Docker CLI.

```bash
brew install colima docker supabase/tap/supabase deno
colima start --cpu 4 --memory 8 
```

Add this to `~/.zshrc` so every shell has it:

```bash
export LANG=en_US.UTF-8                                  # without it `pod install` dies on an ASCII encoding error
export DOCKER_HOST="unix://$HOME/.colima/default/docker.sock"   # else the CLI says "docker not found"
export PUBLIC_API_URL="http://127.0.0.1:54321"           # else recorded talks won't play
export ANDROID_HOME=$HOME/Library/Android/sdk            # Android only
export PATH=$PATH:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator
```

`PUBLIC_API_URL` is read when the stack boots, so it must be set **before** `supabase start`. On a physical device use your machine's LAN IP instead of `127.0.0.1`.

## 2. Start the backend

```bash
npm install
cp .env.example .env.local        # then fill in the two values below
npm run db:start                  # supabase start; prints the API URL and anon key
npm run db:reset                  # applies all migrations + seed.sql to a fresh local DB
```

Put the values `db:start` prints into `.env.local`:

```
EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon / publishable key from db:start>
```

Local ports: API `54321`, Postgres `54322`, Studio `54323` (browse tables and storage), inbound email `54324` (confirm sign-up emails here).

The edge functions (`talks`, `transcribe`) live in `supabase/functions`. To run them locally with hot reload, run `npm run functions:serve` in another shell.

## 3. Build and run the app

First build, once per machine or after a native change:

```bash
npx expo run:ios                              # or: npx expo run:ios --device "iPhone 17 Pro"
npx expo run:android                          # emulator must already be booted
```

The first iOS build generates `ios/`, installs ~100 pods and compiles from scratch: budget 10 to 15 minutes. After that, JS changes need no rebuild:

```bash
npm start                                     # Metro; press i / a to open a simulator, r to reload
npm run dev                                   # same, but also boots the Supabase stack first
```

Rebuild natively (`expo run:*`) only when you add a native dependency, change `app.json` plugins, or touch `ios/` / `android/`. Both folders are generated and gitignored; `rm -rf ios android && npx expo prebuild` resets them.

If sign-up asks you to confirm your email, the message lands in the local inbox (Inbucket) at <http://127.0.0.1:54324>.

## 4. Testing the feedback feature

Feedback has three moving parts. Each needs its own setup.

| Part | What it needs |
| --- | --- |
| **Scoring model** (Settings → feedback model) | `qwen3-1.7b` (default) downloads a **~2 GB** model the first time you tap Get feedback, then stays on disk. It runs on the iOS Simulator. The `native` option uses the platform's built-in model, which the Simulator typically lacks (it needs Apple Intelligence), so test it on a real device. |
| **Transcription** (Settings → transcription) | `device` uses the on-device transcript and needs nothing. `ElevenLabs` calls the `transcribe` edge function for word timings, which needs a key (below). |
| **Saving results** | Feedback and the ElevenLabs transcript are stored on the talk (`sessions.feedback`, `sessions.timed_transcript`). The columns come from migrations, so run `npm run db:reset` after pulling new ones. |

To use ElevenLabs locally, export the key **before** `npm run db:start` (it is passed into the edge runtime by `[edge_runtime.secrets]` in `supabase/config.toml`, read at boot):

```bash
export ELEVEN_API_KEY=<your key>
npm run db:stop && npm run db:start
```

Check the spelling: it must be exactly `ELEVEN_API_KEY`. A typo gives a 503 "Transcription is not configured." ElevenLabs is called once per talk; later runs reuse the stored transcript, so a second run won't show up on the ElevenLabs dashboard.

Scoring takes a while on a small on-device model. The progress card shows each step, and you can leave the screen: the run continues and a banner appears when it finishes. Closing the app ends it.

## 5. Local vs hosted Supabase

The app talks to whatever `EXPO_PUBLIC_SUPABASE_URL` in `.env.local` points at. Metro reads it only at startup, so after changing it run `npm start -- --clear`.

- **Local** (`http://127.0.0.1:54321`): the default for development. Functions run from your working tree.
- **Hosted**: only for things the local stack can't do, such as Google OAuth. Functions and migrations are **not** deployed automatically. Deploy from the checkout that contains the change:

  ```bash
  npx supabase db push --project-ref <ref>
  npx supabase functions deploy <name> --project-ref <ref>
  npx supabase secrets set ELEVEN_API_KEY=<key> --project-ref <ref>
  ```

  Running these from the wrong checkout fails with "entrypoint path does not exist", or silently pushes nothing, because the function or migration isn't there.

If feedback or transcription returns "Edge Function returned a non-2xx status code", check which backend `.env.local` points at and whether that backend has the function and migrations deployed.

## 6. Working in a git worktree

A new worktree (`<repo>/.claude/worktrees/<name>`) is not a full checkout. Before it will run:

```bash
npm install
cp ../../../.env.local .env.local     # from the main checkout; gitignored, so never inherited
npm start -- --clear                  # Metro must run from THIS worktree
```

Metro from another worktree serves that branch's JS, the usual reason "my changes aren't showing". If port 8081 is taken, use `--port <n>` and point the app's dev menu at it.

The simulator holds **one** `com.anonymous.peitho` install, and whichever checkout last ran `expo run:ios` wins. If you see `Cannot find native module 'ExpoAiKit'` (or any other native module), the installed app was built from a checkout that lacks that package. Rebuild from the worktree you are working in:

```bash
npx expo run:ios --device <simulator-udid> --no-bundler
```

## 7. Before you push

CI runs these on every PR:

```bash
npm run typecheck
npm run lint
npm run format:check      # npm run format fixes it
npm run functions:check   # Deno lint + fmt + type check for edge functions
```

Note that `functions:check` only type-checks `talks/index.ts`, not `transcribe`. Run `deno check transcribe/index.ts` from `supabase/functions` when you change it.

## Quick fixes

| Symptom | Fix |
| --- | --- |
| `supabase start`: "docker: command not found" | `DOCKER_HOST` isn't exported (section 1). |
| `network supabase_network_peitho not found` | Stale network: `npm run db:stop -- --no-backup && npm run db:start`. |
| "Unable to download asset" playing a talk | `PUBLIC_API_URL` wasn't set before `supabase start`. Export it and restart the stack. |
| App crashes with `supabaseUrl is required.` | `.env.local` is missing (new worktree) or Metro needs `--clear`. |
| `pod install`: `Unicode Normalization ... ASCII-8BIT` | `LANG` isn't set to a UTF-8 locale. |
| Android: foojay / `IBM_SEMERU` crash | No JDK 17 installed (JDK 21 doesn't work). |
| No simulators listed | `xcodebuild -downloadPlatform iOS` (about 9 GB). |
