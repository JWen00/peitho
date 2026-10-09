// Type-only imports are erased at build time, so this module carries no runtime
// dependency on expo-ai-kit. The native module is pulled in lazily inside
// `scoreTalk` (see below) — that keeps the pure exports (SKILLS, bandFor, the
// types) importable from a build that does not include the native module, e.g.
// the dev story gallery, without the top-level `requireNativeModule` crashing.
import type { JSONSchema, LLMMessage } from 'expo-ai-kit';

import { computeMetrics, computeMetricsFromWords, type TalkMetrics } from './metrics';
import type { FeedbackModel, TranscriptionSource } from './settings';
import { transcribeTalk } from './transcribe';

/** The seven skills scored, each defined by its self-check question. */
export type SkillKey =
  | 'clarity'
  | 'flow'
  | 'structure'
  | 'engagement'
  | 'expression'
  | 'flexibility'
  | 'vocabulary';

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
  {
    key: 'vocabulary',
    label: 'Vocabulary',
    question: 'Did I use specific, vivid words instead of vague ones?',
  },
];

/** The two focused coaches: content judges substance, language judges the words. */
type ContentKey = 'clarity' | 'structure' | 'engagement' | 'expression' | 'flexibility';
type LanguageKey = 'flow' | 'vocabulary';

export interface TalkFeedback {
  scores: Record<SkillKey, number>;
  /** 0–100. Shown as a number plus a band, see {@link bandFor}. */
  overall: number;
  strengths: string[];
  suggestions: string[];
}

/** One skill's result from the per-skill coach. */
export interface SkillNote {
  score: number;
  strength: string;
  suggestion: string;
}

/**
 * A feedback run that scored some skills but not all — kept so the finished
 * skills are not thrown away and a later run only has to do the rest.
 */
export interface PartialFeedback {
  partial: true;
  skills: Partial<Record<SkillKey, SkillNote>>;
}

export function isPartial(
  feedback: TalkFeedback | PartialFeedback,
): feedback is PartialFeedback {
  return 'partial' in feedback;
}

/** The skills a partial result is still missing, in display order. */
export function missingSkills(partial: PartialFeedback): typeof SKILLS {
  return SKILLS.filter((s) => !partial.skills[s.key]);
}

export type Band = 'Getting there' | 'Solid' | 'Sharp';

/** Maps the 0–100 overall score to its band. Kept in code so it is deterministic. */
export function bandFor(overall: number): Band {
  if (overall >= 85) return 'Sharp';
  if (overall >= 60) return 'Solid';
  return 'Getting there';
}

const skillScore: JSONSchema = { type: 'integer', enum: [1, 2, 3, 4, 5] };

// --- Content coach: the substance of the talk -----------------------------

const CONTENT_SYSTEM = [
  'You are a warm, encouraging impromptu-speaking coach. Judge only the SUBSTANCE',
  'of a one-minute talk from its transcript. Lead with what worked, then give one',
  'specific, encouraging suggestion — a gentle "next time, try..." nudge, never',
  'harsh. Score each skill 1-5 (1 = needs work, 3 = solid, 5 = excellent).',
].join(' ');

const CONTENT_SKILLS = SKILLS.filter((s) => s.key !== 'flow' && s.key !== 'vocabulary');

const CONTENT_SCHEMA: JSONSchema = {
  type: 'object',
  properties: {
    scores: {
      type: 'object',
      properties: {
        clarity: skillScore,
        structure: skillScore,
        engagement: skillScore,
        expression: skillScore,
        flexibility: skillScore,
      },
      required: ['clarity', 'structure', 'engagement', 'expression', 'flexibility'],
    },
    strengths: {
      type: 'array',
      items: { type: 'string' },
      description: 'One or two specific, encouraging strengths.',
    },
    suggestions: {
      type: 'array',
      items: { type: 'string' },
      description: 'One gentle, actionable suggestion about the content.',
    },
  },
  required: ['scores', 'strengths', 'suggestions'],
};

function buildContentMessage(topic: string, transcript: string): string {
  return [
    `TOPIC: ${topic}`,
    '',
    'TRANSCRIPT:',
    '"""',
    transcript,
    '"""',
    '',
    'Rate each skill 1-5 using its question:',
    ...CONTENT_SKILLS.map((s) => `• ${s.key} — ${s.question}`),
  ].join('\n');
}

// --- Language coach: fillers and word choice ------------------------------

const VAGUE_WORDS_HINT =
  'good, bad, nice, interesting, great, hard, important, small, different, weird, ' +
  'cool, beautiful, ugly, fast, slow, busy, boring, smart, strong, weak';

const LANGUAGE_SYSTEM = [
  'You are a supportive speech coach focused on WORD CHOICE and delivery.',
  'Encourage specific, vivid language and natural flow. Give concrete fixes: name',
  'the exact filler or vague word the speaker overused and offer a sharper',
  'replacement. Never harsh. Score each skill 1-5 (1 = needs work, 5 = excellent).',
  `Vague catch-all adjectives to replace include: ${VAGUE_WORDS_HINT}.`,
].join(' ');

const LANGUAGE_SCHEMA: JSONSchema = {
  type: 'object',
  properties: {
    scores: {
      type: 'object',
      properties: { flow: skillScore, vocabulary: skillScore },
      required: ['flow', 'vocabulary'],
    },
    suggestions: {
      type: 'array',
      items: { type: 'string' },
      description: 'One or two concrete word-choice or flow fixes, with replacements.',
    },
  },
  required: ['scores', 'suggestions'],
};

function buildLanguageMessage(transcript: string, metrics: TalkMetrics): string {
  const vague = metrics.vagueWords.length
    ? metrics.vagueWords.map((v) => `${v.word} ×${v.count}`).join(', ')
    : 'none detected';
  const pause =
    metrics.maxPauseSeconds != null ? `${metrics.maxPauseSeconds}s` : 'unknown';

  return [
    `MEASURED — fillers: ${metrics.fillerCount} · longest pause: ${pause} · vague words used: ${vague}`,
    '(Measured, not guessed. Base flow on fillers/pause, vocabulary on vague words.)',
    '',
    'TRANSCRIPT:',
    '"""',
    transcript,
    '"""',
    '',
    'Rate each skill 1-5 using its question:',
    '• flow — Did I speak naturally without getting stuck?',
    '• vocabulary — Did I use specific, vivid words instead of vague ones?',
  ].join('\n');
}

// --- Per-skill coach (qwen): one short prompt per skill ---------------------
//
// The downloadable model is slow, and its latency grows with prompt and output
// length. Instead of two long passes it gets seven tiny ones: a single skill, a
// single score, one strength and one suggestion. Each call is quick and much
// harder for a 1.7B model to get wrong.

const SKILL_SYSTEM = [
  'You are a warm, encouraging impromptu-speaking coach. You judge ONE skill of a',
  'one-minute talk from its transcript. Score it 1-5 (1 = needs work, 3 = solid,',
  '5 = excellent), name one thing that worked, and give one gentle, specific',
  '"next time, try..." suggestion. Never harsh. Keep each sentence short.',
].join(' ');

const SKILL_SCHEMA: JSONSchema = {
  type: 'object',
  properties: {
    score: skillScore,
    strength: {
      type: 'string',
      description: 'One short sentence on what worked for this skill.',
    },
    suggestion: {
      type: 'string',
      description: 'One short, actionable suggestion for this skill.',
    },
  },
  required: ['score', 'strength', 'suggestion'],
};

/** Measured stats, given only to the skills they bear on. */
function measuredFor(key: SkillKey, metrics: TalkMetrics): string[] {
  if (key === 'flow') {
    const pause =
      metrics.maxPauseSeconds != null ? `${metrics.maxPauseSeconds}s` : 'unknown';
    return [
      `MEASURED — fillers: ${metrics.fillerCount} · longest pause: ${pause}`,
      '(Measured, not guessed. Base the score on these. Name an overused filler.)',
      '',
    ];
  }
  if (key === 'vocabulary') {
    const vague = metrics.vagueWords.length
      ? metrics.vagueWords.map((v) => `${v.word} ×${v.count}`).join(', ')
      : 'none detected';
    return [
      `MEASURED — vague words used: ${vague}`,
      `(Measured, not guessed. Vague catch-all adjectives include: ${VAGUE_WORDS_HINT}.`,
      'Suggest a sharper replacement for one vague word the speaker used.)',
      '',
    ];
  }
  return [];
}

function buildSkillMessage(
  skill: (typeof SKILLS)[number],
  topic: string,
  transcript: string,
  metrics: TalkMetrics,
): string {
  return [
    `SKILL: ${skill.label} — ${skill.question}`,
    '',
    ...measuredFor(skill.key, metrics),
    `TOPIC: ${topic}`,
    '',
    'TRANSCRIPT:',
    '"""',
    transcript,
    '"""',
  ].join('\n');
}

// --- Merge -----------------------------------------------------------------

interface ContentResult {
  scores: Record<ContentKey, number>;
  strengths: string[];
  suggestions: string[];
}

interface LanguageResult {
  scores: Record<LanguageKey, number>;
  suggestions: string[];
}

/** Overall 0–100 from the mean of all skill scores — computed, not asked of the model. */
function computeOverall(scores: Record<SkillKey, number>): number {
  const values = SKILLS.map((s) => scores[s.key]);
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  return Math.round((mean / 5) * 100);
}

export type FeedbackResult =
  | { status: 'ok'; feedback: TalkFeedback }
  /** Some skills scored, others did not: the finished ones, to save and resume from. */
  | { status: 'partial'; partial: PartialFeedback }
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
    case 'DOWNLOAD_CORRUPT':
    case 'DOWNLOAD_STORAGE_FULL':
      return 'The on-device model could not be downloaded. Check storage and try again.';
    case 'MODEL_LOAD_FAILED':
      return 'The on-device model could not be loaded. Try again, or switch models in Settings.';
    case 'INFERENCE_FAILED':
      return 'The model gave an answer the app could not read. Try again.';
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

type AiKit = typeof import('expo-ai-kit');

/**
 * Where a scoring run is, for a progress UI. Phases arrive in this order; any of
 * the first three may be skipped (model already on disk, device transcript).
 */
export type FeedbackProgress =
  /** First run only: fetching the model file, 0..1. */
  | { phase: 'downloading'; progress: number }
  /** Loading the model into memory. */
  | { phase: 'preparing' }
  /** Re-transcribing with ElevenLabs for word timings. */
  | { phase: 'transcribing' }
  /**
   * Generating prompt `step` (0-based) of the run's prompts, named by `labels`;
   * `completed` lists those already done (including ones kept from an earlier run).
   */
  | { phase: 'scoring'; step: number; labels: string[]; completed: string[] };

type OnProgress = (progress: FeedbackProgress) => void;

const TWO_PASS_LABELS = ['Content', 'Language'];
const SKILL_LABELS = SKILLS.map((s) => s.label);

/**
 * Built-in model: two focused passes, run sequentially (one on-device model
 * cannot handle concurrent generations). Content judges substance; language
 * judges words.
 */
async function scoreTwoPass(
  ai: AiKit,
  topic: string,
  transcript: string,
  metrics: TalkMetrics,
  onProgress?: OnProgress,
): Promise<TalkFeedback> {
  onProgress?.({ phase: 'scoring', step: 0, labels: TWO_PASS_LABELS, completed: [] });
  const contentMessages: LLMMessage[] = [
    { role: 'user', content: buildContentMessage(topic, transcript) },
  ];
  const content = await ai.generateObject<ContentResult>(
    contentMessages,
    CONTENT_SCHEMA,
    {
      systemPrompt: CONTENT_SYSTEM,
      maxRepairAttempts: 2,
    },
  );

  onProgress?.({
    phase: 'scoring',
    step: 1,
    labels: TWO_PASS_LABELS,
    completed: ['Content'],
  });
  const languageMessages: LLMMessage[] = [
    { role: 'user', content: buildLanguageMessage(transcript, metrics) },
  ];
  const language = await ai.generateObject<LanguageResult>(
    languageMessages,
    LANGUAGE_SCHEMA,
    { systemPrompt: LANGUAGE_SYSTEM, maxRepairAttempts: 2 },
  );

  const scores: Record<SkillKey, number> = {
    ...content.object.scores,
    ...language.object.scores,
  };
  return {
    scores,
    overall: computeOverall(scores),
    strengths: content.object.strengths.slice(0, 2),
    suggestions: [...content.object.suggestions, ...language.object.suggestions].slice(
      0,
      3,
    ),
  };
}

/** Builds the final feedback from a note for every skill. */
function assembleFeedback(notes: Record<SkillKey, SkillNote>): TalkFeedback {
  const results = SKILLS.map((s) => ({ key: s.key, note: notes[s.key] }));
  const scores = Object.fromEntries(
    results.map(({ key, note }) => [key, note.score]),
  ) as Record<SkillKey, number>;
  // Stable sorts keep SKILLS order among equal scores. Strengths come from the
  // highest-scoring skills and suggestions from the lowest, so the advice
  // targets what most needs work.
  const best = [...results].sort((a, b) => b.note.score - a.note.score);
  const worst = [...results].sort((a, b) => a.note.score - b.note.score);
  return {
    scores,
    overall: computeOverall(scores),
    strengths: best.slice(0, 2).map(({ note }) => note.strength),
    suggestions: worst.slice(0, 3).map(({ note }) => note.suggestion),
  };
}

/**
 * Downloadable model: one short prompt per skill, run sequentially.
 *
 * A skill whose answer cannot be read (`INFERENCE_FAILED`) is skipped and the
 * rest still run; any other error stops the run. Either way the skills already
 * scored are returned as a {@link PartialFeedback} rather than discarded — and
 * `resume` feeds such a result back in so only the missing skills are redone.
 */
async function scorePerSkill(
  ai: AiKit,
  topic: string,
  transcript: string,
  metrics: TalkMetrics,
  resume: PartialFeedback['skills'],
  onProgress?: OnProgress,
): Promise<TalkFeedback | PartialFeedback> {
  const notes: Partial<Record<SkillKey, SkillNote>> = { ...resume };
  const completed = () => SKILLS.filter((s) => notes[s.key]).map((s) => s.label);
  let stopped: unknown = null;

  for (const [index, skill] of SKILLS.entries()) {
    if (notes[skill.key]) continue;
    onProgress?.({
      phase: 'scoring',
      step: index,
      labels: SKILL_LABELS,
      completed: completed(),
    });
    const messages: LLMMessage[] = [
      { role: 'user', content: buildSkillMessage(skill, topic, transcript, metrics) },
    ];
    try {
      const { object } = await ai.generateObject<SkillNote>(messages, SKILL_SCHEMA, {
        systemPrompt: SKILL_SYSTEM,
        maxRepairAttempts: 2,
      });
      console.log(`[feedback] ${skill.key} = ${object.score}`);
      notes[skill.key] = object;
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      console.warn(`[feedback] ${skill.key} failed:`, code, error);
      stopped = error;
      // An unreadable answer is specific to this skill; anything else (out of
      // memory, model gone) will hit the next one too, so stop.
      if (code !== 'INFERENCE_FAILED') break;
    }
  }

  if (SKILLS.every((s) => notes[s.key]))
    return assembleFeedback(notes as Record<SkillKey, SkillNote>);
  // Nothing scored at all: that is a plain failure, not a partial result.
  if (Object.keys(notes).length === 0) throw stopped;
  return { partial: true, skills: notes };
}

/**
 * Scores one saved talk with the on-device model and returns structured feedback.
 *
 * When `source` is 'elevenlabs', re-transcribes via the `transcribe` edge
 * function for a timestamped transcript (real filler/pause numbers), falling
 * back to the on-device transcript if that fails; 'device' uses the on-device
 * transcript directly. Scoring itself is always on-device (qwen3-1.7b).
 *
 * `onProgress` reports each phase (download, model load, transcription, and
 * each scoring prompt) for a progress UI — see {@link FeedbackProgress}.
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
  /** Skills already scored by an earlier, unfinished run; only the rest are redone. */
  resume?: PartialFeedback['skills'];
  onProgress?: OnProgress;
}): Promise<FeedbackResult> {
  // require (not dynamic import) so Metro returns the named exports directly:
  // expo-ai-kit ships ESM-syntax .js with no "type"/"exports", where `await
  // import()` can hand back a wrapper whose `generateObject`/`isAvailable` are
  // undefined. This stays lazy — a build without the native module throws at
  // `requireNativeModule` here, which we treat as "unavailable" not a crash.
  let ai: AiKit;
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
        input.onProgress?.({ phase: 'downloading', progress: 0 });
        await ai.downloadModel(MODEL_ID, {
          onProgress: (progress) =>
            input.onProgress?.({ phase: 'downloading', progress }),
        });
      }
      input.onProgress?.({ phase: 'preparing' });
      if (ai.getActiveModel() !== MODEL_ID) await ai.setModel(MODEL_ID);
    } else {
      // Built-in model. Revert first if a downloadable is currently loaded.
      if (ai.getActiveModel() === MODEL_ID) await ai.unloadModel().catch(() => {});
      if (!(await ai.isAvailable())) return { status: 'unavailable' };
      input.onProgress?.({ phase: 'preparing' });
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
        input.onProgress?.({ phase: 'transcribing' });
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

    if (input.model === 'qwen3-1.7b') {
      const scored = await scorePerSkill(
        ai,
        input.topic,
        transcript,
        metrics,
        input.resume ?? {},
        input.onProgress,
      );
      if (isPartial(scored)) {
        console.log('[feedback] partial; scored', Object.keys(scored.skills).length);
        return { status: 'partial', partial: scored };
      }
      console.log('[feedback] scored; overall =', scored.overall);
      return { status: 'ok', feedback: scored };
    }

    const feedback = await scoreTwoPass(
      ai,
      input.topic,
      transcript,
      metrics,
      input.onProgress,
    );
    console.log('[feedback] scored; overall =', feedback.overall);
    return { status: 'ok', feedback };
  } catch (error) {
    // ModelError carries a `code`; read it structurally so we need not import the
    // class. An unavailable device/build is not a real failure.
    const code = (error as { code?: unknown }).code;
    // The user sees a short message; keep the real cause findable in the logs.
    console.warn('[feedback] failed:', code, error);
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
