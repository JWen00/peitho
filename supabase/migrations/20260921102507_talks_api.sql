-- Server-owned invariants behind the talks API.
--
-- Three things move off the client: idempotency for the save, the attempt
-- counter, and the heatmap aggregate. All of them were either racy or
-- over-fetching when done from the device.

-- Idempotency ---------------------------------------------------------------

-- A mobile client that times out mid-upload will retry the save, and without a
-- key to dedupe on that produces two talks for one recording. The client mints
-- this once per recording and resends the same value on every retry.
alter table sessions add column client_talk_id uuid;

-- Partial: rows predating this column, and any future server-side insert that
-- has no client to key off, stay unconstrained.
create unique index sessions_user_id_client_talk_id_key
  on sessions (user_id, client_talk_id)
  where client_talk_id is not null;

-- Attempt numbering ---------------------------------------------------------

-- Retries on the same topic on the same day are numbered in order. The client
-- used to compute this with a count-then-insert, which two in-flight saves can
-- both read before either writes. The trigger closes the read half; the unique
-- index below closes the write half, turning a lost race into a 23505 the
-- caller can retry rather than a silent duplicate.
--
-- `attempt_number` is server-owned: whatever the caller sends is discarded.
create or replace function sessions_set_attempt_number()
returns trigger
language plpgsql
as $$
begin
  select coalesce(max(attempt_number), 0) + 1
    into new.attempt_number
    from sessions
   where user_id = new.user_id
     and local_date = new.local_date
     and topic_text = new.topic_text;

  return new;
end;
$$;

-- Not `security definer`: the function reads only rows matching `new.user_id`,
-- which is exactly what the caller's own RLS policy already grants.
create trigger sessions_set_attempt_number
  before insert on sessions
  for each row
  execute function sessions_set_attempt_number();

create unique index sessions_attempt_number_key
  on sessions (user_id, local_date, topic_text, attempt_number);

-- Heatmap -------------------------------------------------------------------

-- The calendar grid wants one count per day across a whole year — a few hundred
-- tiny rows. Paginating that through the talks list would either over-fetch the
-- list or under-fill the grid, so it gets its own call.
create or replace function talk_heatmap(from_date date, to_date date)
returns table (talk_date date, talk_count int)
language sql
stable
as $$
  select local_date, count(*)::int
    from sessions
   where user_id = auth.uid()
     and local_date between from_date and to_date
   group by local_date
   order by local_date;
$$;

-- Redundant with the explicit `auth.uid()` filter above, which is there so the
-- planner can use sessions_user_id_local_date_idx. RLS still applies either way.
revoke execute on function talk_heatmap(date, date) from public;
grant execute on function talk_heatmap(date, date) to authenticated;
