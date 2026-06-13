# Impromptu Speaking Trainer — Build Plan

A daily impromptu-speaking practice app. Get a random topic, plan for 2 minutes, record for 1 minute, get a transcript. Track activity on a heatmap. LLM feedback comes after the MVP ships.

---

## 1. Locked decisions

| Area | Decision |
|---|---|
| Platforms | iOS + Android, one codebase |
| Framework | React Native via **Expo** (development builds, not Expo Go — native modules required) |
| Speech-to-text | **On-device** native APIs (iOS `SFSpeechRecognizer`/`SpeechAnalyzer`, Android `SpeechRecognizer`). Free, no key, private |
| Transcript timing | Generated **after** the recording ends. No live captions shown while speaking |
| Audio | Recording **and** transcript both saved |
| Backend | Supabase — auth + Postgres + Storage |
| LLM feedback | **Post-MVP.** Key held server-side in a Supabase Edge Function, never in the app |
| Daily semantics | Unlimited attempts; a day is "active" if ≥1 recording exists. "Today" = device local timezone |
| Cutoff | Hard stop at 1:00, with a visible countdown and a gentle haptic + visual cue at 0:10 left |
| Interruptions | Call / backgrounding / lock mid-record → stop, discard partial clip, show "interrupted, try again" |
| Retry | Same topic, new recording, both attempts viewable |

---

## 2. Architecture at a glance

```
┌─────────────────────────────────────────────┐
│                React Native (Expo)            │
│                                               │
│  Topic generator → Plan timer → Record (1:00) │
│        → on-device STT → transcript           │
│                                               │
│  Local: audio file + transcript               │
└───────────────┬───────────────────────────────┘
                │ supabase-js
                ▼
┌─────────────────────────────────────────────┐
│                  Supabase                      │
│  Auth   │  Postgres (sessions, topics)         │
│  Storage (audio files, per-user folders)       │
│  RLS on everything                             │
│  Edge Function (LLM proxy) ── POST-MVP only    │
└─────────────────────────────────────────────┘
```

Transcription happens entirely on the phone before anything is uploaded. Supabase stores the results; it never sees the audio mid-process.

---

## 3. Data model (Supabase Postgres)

```sql
-- Topics pool (seeded; can grow later)
create table topics (
  id uuid primary key default gen_random_uuid(),
  text text not null,
  category text,
  active boolean default true,
  created_at timestamptz default now()
);

-- One row per recording attempt
create table sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  topic_id uuid references topics(id),
  topic_text text not null,          -- denormalized snapshot
  transcript text,
  audio_path text,                   -- path in Storage bucket
  duration_seconds int,              -- usually 60, less if user stopped early
  attempt_number int default 1,      -- for retries on the same topic
  local_date date not null,          -- device-local calendar day, for the heatmap
  created_at timestamptz default now()
);

create index on sessions (user_id, local_date);
```

Two deliberate choices:
- **`topic_text` is snapshotted** onto the session so edits to the topics table never rewrite history.
- **`local_date` is computed on the device** and stored, so the heatmap reflects the user's day, not UTC. This avoids the classic "my streak broke at 4pm" timezone bug.

**Row Level Security** — non-negotiable, turn it on before the first insert:

```sql
alter table sessions enable row level security;

create policy "own rows" on sessions
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- topics are world-readable
alter table topics enable row level security;
create policy "read topics" on topics for select using (true);
```

**Storage:** one bucket (e.g. `recordings`), private, files keyed by `user_id/{session_id}.m4a`. Add a Storage policy so a user can only read/write inside their own `user_id/` prefix.

---

## 4. Build phases

### Phase 0 — Foundations (½–1 day)
- `npx create-expo-app`, set up TypeScript, dev build (EAS or local prebuild).
- Create the Supabase project; run the schema + RLS above; seed ~50 topics.
- Wire `supabase-js` with session persistence (`AsyncStorage`, or `expo-secure-store` for tokens).
- Confirm a dev build runs on a real iOS device and a real Android device. **Do not skip real-device testing — STT and audio behave differently from simulators.**

### Phase 1 — Auth (½ day)
- Email/password sign-up + sign-in via Supabase Auth.
- **Apple requirement:** if you add Google/social sign-in on iOS, you must also offer Sign in with Apple. Easiest MVP path: ship email-only first, add social later.
- Session restore on app launch; sign-out.

### Phase 2 — The core loop (the heart of the app, 3–5 days)
This is where the real engineering is. Build it as a small state machine:

```
IDLE → TOPIC_SHOWN → PLANNING(2:00) → READY → RECORDING(1:00)
     → TRANSCRIBING → REVIEW → SAVED
```

- **Topic generator:** pull active topics, pick one at random (avoid immediate repeats by tracking the last few shown).
- **Planning timer:** 2:00 countdown, with a "Start recording" button to skip ahead.
- **Recording:** use `expo-audio` (the current Expo audio module; `expo-av` is on its way out). Request mic permission. Record to `.m4a`.
  - Visible countdown the whole time.
  - Haptic + visual cue at 0:10 remaining (`expo-haptics`).
  - **Hard cutoff at exactly 1:00** — set a timer that calls stop; don't rely on the user.
- **Interruption handling:** subscribe to audio-interruption / app-state-background events. On interruption → stop recorder, delete the partial file, return to READY with a message. Test this explicitly by calling the phone mid-record.
- **Transcription (after stop):** feed the saved audio (or the recognizer's buffered result) to on-device STT.
  - Candidate library: `expo-speech-recognition`, which wraps `SFSpeechRecognizer` on iOS and `SpeechRecognizer` on Android and supports on-device mode. Verify current API and whether it transcribes a file or requires live mic capture — this affects whether you transcribe *during* recording (silently, no UI) or from the saved file afterward.
  - Show a brief "transcribing…" state. Falls back gracefully if the device returns nothing.
- **Review screen:** topic, transcript, playback of the recording, "Save" / "Try again."
- **Save:** upload audio to Storage at `user_id/{session_id}.m4a`, insert the `sessions` row with `local_date` computed on-device.

> **Verify before coding:** the exact package names, versions, and whether on-device file transcription is supported are the most fast-moving details here. Check the Expo docs and the chosen STT library's README at build time rather than trusting any snapshot.

### Phase 3 — History & heatmap (1–2 days)
- **Heatmap:** query `sessions` grouped by `local_date`, render a GitHub-style calendar grid. Use a maintained RN calendar-heatmap component or draw it with SVG (`react-native-svg`). Tap a day → list that day's sessions.
- **Session detail / list:** topic, transcript, audio playback, attempt number. Side-by-side view of attempt 1 vs 2 for retries is a nice touch if time allows.

### Phase 4 — Privacy & account management (½–1 day, required for store review)
Because you store voice recordings, both stores effectively require this:
- **Delete account / delete my recordings** flow: removes Storage files + `sessions` rows. `on delete cascade` handles the DB side once the auth user is deleted; Storage objects must be deleted explicitly.
- **Privacy policy** page/URL covering: what's recorded, that transcription is on-device, where audio is stored, and how to delete it.
- Mic + speech-recognition usage strings in `Info.plist` / Android permissions.

### Phase 5 — Polish & ship (2–4 days)
- Empty states, loading states, error states (no mic permission, offline, STT unavailable on old devices).
- App icon, splash, store screenshots.
- EAS Build → TestFlight + Play internal testing → submit.

---

## 5. Post-MVP: LLM feedback

Wire this only after the loop above is solid.

- Add a Supabase **Edge Function** (`feedback`) that holds the LLM API key as a secret and accepts a transcript, returns feedback. The key never ships in the app.
- Rate-limit per user inside the function (protects your bill).
- On the review screen, add a "Get feedback" button → calls the Edge Function → shows the response → "Try again with another minute."
- Because audio is already saved, you have the option later to send *audio* (not just transcript) to a multimodal model for delivery feedback — pace, pauses, fillers — which a transcript can't capture. Worth keeping in mind, out of scope for now.

---

## 6. Suggested package shortlist

Verify current versions when you start; this is the shape, not the lockfile.

- `expo`, `expo-router` (navigation)
- `@supabase/supabase-js`
- `expo-secure-store` or `@react-native-async-storage/async-storage` (session persistence)
- `expo-audio` (recording + playback)
- `expo-speech-recognition` (on-device STT — confirm file-vs-live support)
- `expo-haptics` (the 0:10 cue)
- `react-native-svg` (heatmap, if hand-drawn)
- a calendar-heatmap component (or build on SVG)

---

## 7. Risks & gotchas, ranked

1. **On-device STT quality varies by device and OS version.** Old/cheap Androids may be weak or lack an on-device engine. Plan a graceful "transcript unavailable" fallback — the recording still saves. A Groq Whisper cloud fallback (generous free tier) is the natural escape hatch later.
2. **Recording reliability is the whole product.** Interruptions, backgrounding, and the exact cutoff are where it'll break. Budget real time here and test on physical devices.
3. **File transcription vs. live capture.** If your STT library only transcribes the live mic stream (not a saved file), you'll transcribe *silently during* recording and reveal the text after — same UX, different plumbing. Resolve this in Phase 2 before building the screen.
4. **Storage costs and privacy scale with audio.** One 1-min `.m4a` is tiny, but it's still personal data — RLS, deletion, and the privacy policy are mandatory, not optional.
5. **Expo Go won't work** for the native STT/audio modules — you need a development build from day one.
6. **Timezones / streaks.** Storing `local_date` from the device sidesteps most of it; just be consistent about computing it on the client.

---

## 8. Rough sequencing

```
Phase 0  Foundations        ▓▓
Phase 1  Auth               ▓
Phase 2  Core loop          ▓▓▓▓▓
Phase 3  Heatmap/history    ▓▓
Phase 4  Privacy/account    ▓▓
Phase 5  Polish & ship      ▓▓▓
         ── then ──
Post-MVP LLM feedback        ▓▓
```

Start at Phase 2's recording flow as soon as Supabase auth works — it's the riskiest piece, so de-risk it early rather than saving it for last.