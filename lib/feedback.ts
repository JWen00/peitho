// Type-only imports are erased at build time, so this module carries no runtime
// dependency on expo-ai-kit. The native module is pulled in lazily inside
// `scoreTalk` (see below) — that keeps the pure exports (SKILLS, bandFor, the
// types) importable from a build that does not include the native module, e.g.
// the dev story gallery, without the top-level `requireNativeModule` crashing.
import type { JSONSchema, LLMMessage } from 'expo-ai-kit';

import { computeMetrics, computeMetricsFromWords, type TalkMetrics } from './metrics';
import type { FeedbackModel, TranscriptionSource } from './settings';
import { transcribeTalk } from './transcribe';

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
  const stats =
    `SPOKEN: ${metrics.wordCount} words (~${metrics.wpm} words/min) · ` +
    `FILLERS DETECTED: ${metrics.fillerCount}` +
    (metrics.maxPauseSeconds != null
      ? ` · LONGEST PAUSE: ${metrics.maxPauseSeconds}s`
      : '');

  return [
    `TOPIC: ${topic}`,
    stats,
    '(Stats are measured, not guessed. Treat 0 fillers as "none detected".)',
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
 * The downloadable model used for scoring. A LiteRT model (~2GB) rather than the
 * platform built-in, so it runs without Apple Intelligence — including on the
 * arm64 iOS Simulator. Downloaded once; the file survives app restarts.
 */
const MODEL_ID = 'qwen3-1.7b';

/**
 * Scores one saved talk with the on-device model and returns structured feedback.
 *
 * When `source` is 'elevenlabs', re-transcribes via the `transcribe` edge
 * function for a timestamped transcript (real filler/pause numbers), falling
 * back to the on-device transcript if that fails; 'device' uses the on-device
 * transcript directly. Scoring itself is always on-device (qwen3-1.7b).
 *
 * The first run downloads the model — `onDownloadProgress` reports 0..1 for a UI.
 *
 * Never throws: unsupported devices/builds come back as `unavailable` (the caller
 * shows a gentle fallback), and real failures as `error`.
 */
export async function scoreTalk(input: {
  talkId: string;
  topic: string;
  transcript: string;
  durationSeconds: number | null;
  source: TranscriptionSource;
  model: FeedbackModel;
  onDownloadProgress?: (progress: number) => void;
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
    if (input.model === 'qwen3-1.7b') {
      // Downloadable model: ensure it is on disk and loaded. `setModel` is the
      // gate — once it resolves, generateObject uses this model.
      const model = (await ai.getDownloadableModels()).find((m) => m.id === MODEL_ID);
      if (!model)
        return { status: 'error', message: 'The feedback model is unavailable.' };
      if (!model.meetsRequirements) return { status: 'unavailable' };

      if (model.status !== 'downloaded' && model.status !== 'ready') {
        console.log(
          `[feedback] downloading ${MODEL_ID} (~${Math.round(model.sizeBytes / 1e6)}MB)…`,
        );
        await ai.downloadModel(MODEL_ID, { onProgress: input.onDownloadProgress });
      }
      if (ai.getActiveModel() !== MODEL_ID) await ai.setModel(MODEL_ID);
    } else {
      // Built-in model. Revert first if a downloadable is currently loaded.
      if (ai.getActiveModel() === MODEL_ID) await ai.unloadModel().catch(() => {});
      if (!(await ai.isAvailable())) return { status: 'unavailable' };
      await ai.prepareBuiltInModel();
    }
    console.log(`[feedback] active model = ${ai.getActiveModel()}`);

    // Default to the on-device transcript (text-only metrics). When the user has
    // chosen ElevenLabs, re-transcribe for word timings, falling back to the
    // on-device transcript if that call fails.
    let transcript = input.transcript;
    let metrics = computeMetrics(transcript, input.durationSeconds);
    console.log(`[feedback] transcription source = ${input.source}`);
    if (input.source === 'elevenlabs') {
      try {
        const timed = await transcribeTalk(input.talkId);
        if (timed.text.trim()) {
          transcript = timed.text;
          metrics = computeMetricsFromWords(
            timed.text,
            timed.words,
            input.durationSeconds,
          );
          console.log('[feedback] using ElevenLabs transcript; metrics:', metrics);
        }
      } catch {
        console.warn(
          '[feedback] ElevenLabs failed — falling back to on-device transcript',
        );
      }
    }

    const messages: LLMMessage[] = [
      { role: 'user', content: buildUserMessage(input.topic, transcript, metrics) },
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
