-- Dev seed data. Applied by `supabase db reset` on a local stack.
-- Not run against the hosted project by `db push`.

insert into topics (text, category) values
  ('Describe a place that changed how you think.', 'reflection'),
  ('Argue that the best tool is the one you already know.', 'persuasive'),
  ('Explain your morning to someone from 1850.', 'explanation'),
  ('What is something everyone gets wrong about your field?', 'opinion'),
  ('Tell the story of a decision you nearly made differently.', 'narrative');
