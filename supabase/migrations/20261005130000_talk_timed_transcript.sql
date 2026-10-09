-- The ElevenLabs transcript of a talk, with word timings.
--
-- The `transcribe` function used to call ElevenLabs every time feedback was
-- generated. The audio never changes, so neither does the result: it is stored
-- here on first call and served from here after, so each talk costs one paid
-- API call at most. Shape: { text, words: [{ text, start, end }] }. Null until
-- the first ElevenLabs transcription.
alter table sessions add column timed_transcript jsonb;
