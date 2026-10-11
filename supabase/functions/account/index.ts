/**
 * The account API.
 *
 *   DELETE /account    permanently delete the caller's account and all their data
 *
 * Required by the app stores: anyone who can create an account in the app must be
 * able to delete it from the app. Deleting means everything — the talks, their
 * transcripts and feedback, and the recordings in storage.
 *
 * Two kinds of data, handled differently:
 *   - Rows (`sessions`) go with the user: `sessions.user_id` references
 *     `auth.users` with `on delete cascade`, so deleting the auth user removes them.
 *   - Recordings do not. Storage objects are not rows the database can cascade to,
 *     so they are removed explicitly, *before* the user. If that order were
 *     reversed, a failure between the two steps would leave audio nobody can ever
 *     find or delete again. This way a failure leaves an account that still
 *     exists, and the user simply tries again.
 *
 * The route is `auth: 'user'`: the JWT alone decides whose account this is, and
 * no route takes a user id. `supabaseAdmin` bypasses RLS; it is used only for the
 * two operations that need it — clearing the caller's own storage prefix and
 * deleting the caller's own auth user.
 */
import { Hono } from 'npm:hono@^4.6.0';
import { cors } from 'npm:hono@^4.6.0/cors';
import { HTTPException } from 'npm:hono@^4.6.0/http-exception';
import { withSupabase } from 'npm:@supabase/server@^1.7.0/adapters/hono';
import { AuthError, type SupabaseContext } from 'npm:@supabase/server@^1.7.0';

import type { Database } from '../../../lib/database.types.ts';

const BUCKET = 'recordings';

/** Storage lists in pages; this is the page size and the cap per removal call. */
const PAGE_SIZE = 100;

/**
 * Upper bound on pages, so a bug can never loop forever. 100 pages of 100 is
 * 10,000 recordings: far beyond a daily-practice app, and a retry continues
 * where this one stopped.
 */
const MAX_PAGES = 100;

// Typed explicitly: `withSupabase` sets the variable at runtime, but Hono does not
// carry a middleware's variables through `app.use('*', ...)` into the routes.
type Env = { Variables: { supabaseContext: SupabaseContext<Database> } };

const app = new Hono<Env>().basePath('/account');

app.use('*', cors());
app.use('*', withSupabase<Database>({ auth: 'user' }));

app.delete('/', async (c) => {
  const { supabaseAdmin, userClaims } = c.var.supabaseContext;
  const userId = userClaims!.id;

  // Recordings live at `{user_id}/{talk_id}.{ext}`, so the user's id is a prefix.
  // Remove as we list: each pass lists the first page of what is left, so there
  // is no offset to drift as objects disappear.
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data: objects, error: listError } = await supabaseAdmin.storage
      .from(BUCKET)
      .list(userId, { limit: PAGE_SIZE });
    if (listError) throw listError;
    if (!objects || objects.length === 0) break;

    const { error: removeError } = await supabaseAdmin.storage
      .from(BUCKET)
      .remove(objects.map((object: { name: string }) => `${userId}/${object.name}`));
    if (removeError) throw removeError;
  }

  // Cascades to the user's `sessions` rows. Any session that survives the line
  // above would mean a bug in the schema, not in this function.
  const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(userId);
  if (deleteError) throw deleteError;

  return c.body(null, 204);
});

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    // Auth failures carry the library's own payload, which names the exact
    // credential problem — far more useful to the client than a bare 401.
    if (err.cause instanceof AuthError) {
      return c.json(err.cause.toJSON(), err.cause.status as 401 | 500);
    }
    return c.json({ code: 'ERROR', message: err.message }, err.status);
  }

  // Storage and Auth errors can name paths and internals. Log them in full; tell
  // the caller only that it was our fault, and that retrying is safe.
  console.error('account:', err);
  return c.json(
    { code: 'INTERNAL_ERROR', message: 'Could not delete the account. Try again.' },
    500,
  );
});

export default { fetch: app.fetch };
