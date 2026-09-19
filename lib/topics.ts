/**
 * MVP topic pool — hardcoded on the device.
 *
 * Phase 0 of the plan seeds a `topics` table in Supabase, but the core loop
 * doesn't need the network to hand out a topic. These ten mirror the shape of
 * a `topics` row (minus `active`/`created_at`), so swapping `getRandomTopic`
 * for a Supabase query later is a drop-in change at the call site.
 *
 * Note: `id` here is a slug, not the uuid the table uses. When saving a
 * session, leave `topic_id` null and rely on the `topic_text` snapshot.
 */

export type TopicCategory = 'personal' | 'opinion' | 'hypothetical' | 'abstract';

export interface Topic {
  id: string;
  text: string;
  category: TopicCategory;
}

export const TOPICS: readonly Topic[] = [
  { id: 'best-advice', text: 'The best piece of advice you have ever ignored.', category: 'personal' },
  { id: 'overrated', text: 'Something everyone loves that you find overrated.', category: 'opinion' },
  { id: 'skill-one-week', text: 'A skill you could teach someone in a single week.', category: 'personal' },
  { id: 'delete-one-invention', text: 'If you could uninvent one thing, what would it be?', category: 'hypothetical' },
  { id: 'changed-my-mind', text: 'Something you used to believe strongly and no longer do.', category: 'personal' },
  { id: 'luck-vs-work', text: 'How much of success is luck?', category: 'abstract' },
  { id: 'last-day-phone', text: 'You lose your phone for a month. What changes?', category: 'hypothetical' },
  { id: 'small-kindness', text: 'A small kindness from a stranger that stayed with you.', category: 'personal' },
  { id: 'school-should-teach', text: 'One thing schools should teach but do not.', category: 'opinion' },
  { id: 'what-is-home', text: 'What makes a place feel like home?', category: 'abstract' },
];

/**
 * Pick a random topic, optionally avoiding an immediate repeat.
 *
 * Pass the id of the topic just shown as `excludeId` and it will never come
 * back twice in a row (unless the pool has only one topic).
 */
export function getRandomTopic(excludeId?: string | null): Topic {
  const pool = excludeId ? TOPICS.filter((topic) => topic.id !== excludeId) : TOPICS;
  const candidates = pool.length > 0 ? pool : TOPICS;
  return candidates[Math.floor(Math.random() * candidates.length)];
}
