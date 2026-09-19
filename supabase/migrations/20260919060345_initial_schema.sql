-- Core schema, RLS and storage for Peitho.
-- Mirrors the design in project.md.

create table topics (
  id uuid primary key default gen_random_uuid(),
  text text not null,
  category text,
  active boolean default true,
  created_at timestamptz default now()
);

-- One row per recording attempt.
create table sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  topic_id uuid references topics(id),
  -- Snapshotted so edits to topics never rewrite history.
  topic_text text not null,
  transcript text,
  -- Path in the recordings bucket: {user_id}/{session_id}.m4a
  audio_path text,
  duration_seconds int,
  attempt_number int default 1,
  -- Device-local calendar day, so the heatmap reflects the user's day, not UTC.
  local_date date not null,
  created_at timestamptz default now()
);

create index sessions_user_id_local_date_idx on sessions (user_id, local_date);

-- Row Level Security -------------------------------------------------------

alter table sessions enable row level security;

create policy "own rows" on sessions
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

alter table topics enable row level security;

create policy "read topics" on topics
  for select using (true);

-- Storage ------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('recordings', 'recordings', false);

-- Each user is confined to their own {user_id}/ prefix.
create policy "own recordings" on storage.objects
  for all to authenticated
  using (
    bucket_id = 'recordings'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'recordings'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
