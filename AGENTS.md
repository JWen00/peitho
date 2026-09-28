# Working on Peitho

Daily impromptu-speaking trainer. React Native + Expo (SDK 56) + Supabase.
See [project.md](project.md) for the architecture and build plan, and
[README.md](README.md) for full local setup.

## Worktrees

At the start of a session, if the task involves changing code (editing, creating, or deleting files), create a new git worktree with an auto-generated name **before** making any changes, and do all work inside it. Skip this for read-only work such as questions, code exploration, or explaining things. If you're already in a worktree, stay in it — don't create another.

### Running a worktree on the simulator

A fresh worktree is **not** a full checkout: its `node_modules` is only partially
populated and the gitignored `.env.local` is absent. The app it serves will not
run — and its changes will not show — until you seed both and serve _from this
worktree_. Do this once per new worktree:

1. **`npm install`** in the worktree. The shared setup leaves dev tools (eslint,
   prettier) and other packages missing, which both CI checks and Metro need.
2. **`cp ../../../.env.local .env.local`** from the main checkout (worktrees live
   at `<main>/.claude/worktrees/<name>`, so the main copy is three levels up).
   Without it the app crashes at launch with `supabaseUrl is required.` —
   `.env.local` is gitignored, so a new worktree never inherits it.
3. **Start Metro from _this_ worktree** (`npm start`). A dev server left running
   in another worktree serves _that_ branch's JS to the simulator — the usual
   reason "my changes aren't showing." Metro reads `EXPO_PUBLIC_*` only at
   startup, so after step 2 (re)start it with `npm start -- --clear`. If another
   worktree already holds port 8081, add `--port <n>` and point the app's dev
   menu at it.
4. **JS-only changes need no native rebuild.** The installed
   `com.anonymous.peitho` debug build loads whatever Metro serves on 8081, so
   just relaunch it: `xcrun simctl launch <udid> com.anonymous.peitho`. Only run
   `npm run ios` when native modules or native config change — and note it
   re-runs prebuild (see the `ios/` / `android/` gotcha below).

## Before writing code

**Expo has changed.** Read the exact versioned docs at
https://docs.expo.dev/versions/v56.0.0/ before writing any Expo code — do not
rely on memory of older APIs.

## Local environment gotchas

These bite every fresh setup; they are not in error messages:

- **Local Supabase runs on Colima, not Docker Desktop.** Any shell running
  `supabase start` / `db reset` / `functions serve` must first
  `export DOCKER_HOST="unix://$HOME/.colima/default/docker.sock"`, or the CLI
  reports a misleading "docker not found". If `supabase start` dies with
  `network supabase_network_peitho not found`, run `supabase stop --no-backup`
  and start again — it's a stale network, not a real failure.
- **Android needs JDK 17 exactly** (Zulu 17), not 21. JDK 21 fails with a
  misleading foojay / `IBM_SEMERU` crash that masks the real cause.
- **iOS `pod install` needs `LANG` set to a UTF-8 locale** or it dies on an
  ASCII encoding error before the build starts.
- `ios/` and `android/` are generated and gitignored; `expo prebuild --clean`
  wipes them (and `android/local.properties`).
- **`.env.local` is gitignored and does not come with a new worktree.** The app
  reads `EXPO_PUBLIC_SUPABASE_URL` / `_ANON_KEY` from it and dies at launch with
  `supabaseUrl is required.` if it is missing — copy it from the main checkout
  (`cp ../../../.env.local .env.local`) and restart Metro. See _Running a
  worktree on the simulator_ above.

## Common commands

`npm run db:start` · `db:reset` · `functions:serve` · `dev` (stack + Metro).
`npm run ios` / `android` for a native build, `npm start` for JS-only reloads.

Before pushing, keep CI green: `npm run typecheck`, `lint`, `format:check`
(app) and `functions:check` (Deno edge functions). CI runs these on every PR.
