# Working on Peitho

Daily impromptu-speaking trainer. React Native + Expo (SDK 56) + Supabase.
See [project.md](project.md) for the architecture and build plan, and
[README.md](README.md) for full local setup.

## Worktrees

At the start of a session, if the task involves changing code (editing, creating, or deleting files), create a new git worktree with an auto-generated name **before** making any changes, and do all work inside it. Skip this for read-only work such as questions, code exploration, or explaining things. If you're already in a worktree, stay in it — don't create another.

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

## Common commands

`npm run db:start` · `db:reset` · `functions:serve` · `dev` (stack + Metro).
`npm run ios` / `android` for a native build, `npm start` for JS-only reloads.

Before pushing, keep CI green: `npm run typecheck`, `lint`, `format:check`
(app) and `functions:check` (Deno edge functions). CI runs these on every PR.
