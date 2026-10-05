-- Coaching feedback, saved with the talk it scores.
--
-- Scoring runs on-device and can take a minute with the downloadable model, so
-- the result is kept rather than regenerated every time the talk is opened.
-- jsonb, not columns: the shape (skills, strengths, suggestions) is the app's
-- and still evolving, and nothing queries inside it. The talks API validates it
-- on write. Null until the user asks for feedback.
alter table sessions add column feedback jsonb;
