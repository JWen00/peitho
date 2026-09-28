// Type-only imports are erased at build time, so this module carries no runtime
// dependency on expo-ai-kit. The native module is pulled in lazily inside
// `scoreTalk` (see below) — that keeps the pure exports (SKILLS, bandFor, the
// types) importable from a build that does not include the native module, e.g.
// the dev story gallery, without the top-level `requireNativeModule` crashing.
import type { JSONSchema, LLMMessage } from 'expo-ai-kit';

import { computeMetrics, type TalkMetrics } from './metrics';

/** The six skills the coach scores, each defined by its self-check question. */
export type SkillKey =
  'clarity' | 'flow' | 'structure' | 'engagement' | 'expression' | 'flexibility';

export const SKILLS: { key: SkillKey; label: string; question: string }[] = [
  { key: 'clarity', label: 'Clarity', question: 'Could someone easily follow me?' },
  {
    key: 'flow',
    label: 'Flow',
    question: 'Did I speak naturally without getting stuck?',
  },
  { key: 'structure', label: 'Structure', question: 'Did my ideas have a clear shape?' },
  {
    key: 'engagement',
    label: 'Engagement',
    question: 'Did I give the listener something interesting to respond to?',
  },
  {
    key: 'expression',
    label: 'Expression',
    question: 'Did my personality or emotion come through?',
  },
  {
    key: 'flexibility',
    label: 'Flexibility',
    question: 'Could I think and speak at the same time?',
  },
];

export interface TalkFeedback {
  scores: Record<SkillKey, number>;
  /** 0–100. Shown as a number plus a band, see {@link bandFor}. */
  overall: number;
  strengths: string[];
  suggestions: string[];
}

export type Band = 'Getting there' | 'Solid' | 'Sharp';

/** Maps the 0–100 overall score to its band. Kept in code so it is deterministic. */
export function bandFor(overall: number): Band {
  if (overall >= 85) return 'Sharp';
  if (overall >= 60) return 'Solid';
  return 'Getting there';
}

const SYSTEM_PROMPT = [
  'You are a warm, encouraging impromptu-speaking coach for a one-minute practice',
  'app. Score the speaker on six skills, then give short, specific, encouraging',
  'feedback. Always lead with what worked. Give at most two suggestions, phrased as',
  'gentle "next time, try..." nudges — never harsh or discouraging. Base every score',
  'only on the transcript and the measured stats provided; do not invent details you',
  'cannot see. Scores are 1-5 (1 = needs work, 3 = solid, 5 = excellent). The overall',
  '0-100 score maps to a band shown to the user — 0-59 "Getting there", 60-84',
  '"Solid", 85-100 "Sharp" — so keep your written feedback consistent with that band',
  'while always staying warm.',
].join(' ');

const skillScore: JSONSchema = { type: 'integer', enum: [1, 2, 3, 4, 5] };

const SCHEMA: JSONSchema = {
  type: 'object',
  properties: {
    scores: {
      type: 'object',
      properties: {
        clarity: skillScore,
        flow: skillScore,
        structure: skillScore,
        engagement: skillScore,
        expression: skillScore,
        flexibility: skillScore,
      },
      required: [
        'clarity',
        'flow',
        'structure',
        'engagement',
        'expression',
        'flexibility',
      ],
    },
    overall: { type: 'integer', description: 'Overall score from 0 to 100.' },
    strengths: {
      type: 'array',
      items: { type: 'string' },
      description: 'One or two specific, encouraging strengths.',
    },
    suggestions: {
      type: 'array',
      items: { type: 'string' },
      description: 'At most two gentle, actionable suggestions.',
    },
  },
  required: ['scores', 'overall', 'strengths', 'suggestions'],
};

function buildUserMessage(
  topic: string,
  transcript: string,
  metrics: TalkMetrics,
): string {
  return [
    `TOPIC: ${topic}`,
    `SPOKEN: ${metrics.wordCount} words (~${metrics.wpm} words/min) · FILLERS DETECTED: ${metrics.fillerCount}`,
    '(Filler count is measured, not guessed. Treat 0 as "none detected" — the',
    'transcript may simply have been cleaned.)',
    '',
    'TRANSCRIPT:',
    '"""',
    transcript,
    '"""',
    '',
    'Rate each skill 1-5 using its question:',
    ...SKILLS.map((s) => `• ${s.key} — ${s.question}`),
  ].join('\n');
}

export type FeedbackResult =
  | { status: 'ok'; feedback: TalkFeedback }
  /** The device or build cannot run the on-device model — show a fallback, not an error. */
  | { status: 'unavailable' }
  | { status: 'error'; message: string };

function messageForCode(code: string): string {
  switch (code) {
    case 'INFERENCE_OOM':
      return 'This device ran out of memory generating feedback. Try again.';
    case 'INFERENCE_BUSY':
      return 'The model is still finishing another request. Try again in a moment.';
    case 'DOWNLOAD_FAILED':
    case 'DOWNLOAD_STORAGE_FULL':
      return 'The on-device model could not be downloaded. Check storage and try again.';
    default:
      return 'Could not generate feedback. Try again.';
  }
}

/**
 * Scores one saved talk with the on-device model and returns structured feedback.
 *
 * Never throws: unsupported devices/builds come back as `unavailable` (the caller
 * shows a gentle fallback), and real failures as `error`.
 */
export async function scoreTalk(input: {
  topic: string;
  transcript: string;
  durationSeconds: number | null;
}): Promise<FeedbackResult> {
  // require (not dynamic import) so Metro returns the named exports directly:
  // expo-ai-kit ships ESM-syntax .js with no "type"/"exports", where `await
  // import()` can hand back a wrapper whose `generateObject`/`isAvailable` are
  // undefined. This stays lazy — a build without the native module throws at
  // `requireNativeModule` here, which we treat as "unavailable" not a crash.
  let ai: typeof import('expo-ai-kit');
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ai = require('expo-ai-kit');
  } catch {
    return { status: 'unavailable' };
  }

  try {
    if (!(await ai.isAvailable())) return { status: 'unavailable' };
    // iOS: no-op once Apple Intelligence is ready. Android: one-time model fetch.
    await ai.prepareBuiltInModel();

    const metrics = computeMetrics(input.transcript, input.durationSeconds);
    const messages: LLMMessage[] = [
      { role: 'user', content: buildUserMessage(input.topic, input.transcript, metrics) },
    ];

    const { object } = await ai.generateObject<TalkFeedback>(messages, SCHEMA, {
      systemPrompt: SYSTEM_PROMPT,
      maxRepairAttempts: 3,
    });
    return { status: 'ok', feedback: object };
  } catch (error) {
    // ModelError carries a `code`; read it structurally so we need not import the
    // class. An unavailable device/build is not a real failure.
    const code = (error as { code?: unknown }).code;
    if (code === 'LLM_NOT_ENABLED' || code === 'DEVICE_NOT_SUPPORTED') {
      return { status: 'unavailable' };
    }
    if (typeof code === 'string') {
      return { status: 'error', message: messageForCode(code) };
    }
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Could not generate feedback.',
    };
  }
}
