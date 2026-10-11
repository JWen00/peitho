import { messageFor } from './sessions';
import { supabase } from './supabase';

/**
 * Permanently deletes the signed-in user's account and everything under it:
 * talks, transcripts, feedback and recordings.
 *
 * The `account` function removes the recordings first and the user last, so a
 * failure leaves an account that still exists and a retry is safe. On success the
 * server-side session is already gone, so the local one is cleared without a
 * server call — a normal `signOut()` would try to revoke a token for a user that
 * no longer exists and report an error. Clearing it fires the auth listener,
 * which sends the app back to the sign-in screen.
 */
export async function deleteAccount(): Promise<void> {
  const { error } = await supabase.functions.invoke('account', { method: 'DELETE' });
  if (error) throw new Error(await messageFor(error));

  await supabase.auth.signOut({ scope: 'local' });
}
