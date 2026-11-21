-- DecisionFlow Acme Product Team Seed Reference (PostgreSQL)
-- Matches the seeded demo workspace in server/db/seed.ts

INSERT INTO teams (id, name) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Acme Product Team')
ON CONFLICT DO NOTHING;

INSERT INTO users (id, name, email, role) VALUES
  ('22222222-2222-2222-2222-222222222201', 'Priya Sharma', 'priya@acme.dev', 'Product Lead'),
  ('22222222-2222-2222-2222-222222222202', 'Rahul Mehta', 'rahul@acme.dev', 'Engineering Lead'),
  ('22222222-2222-2222-2222-222222222203', 'Ananya Krishnan', 'ananya@acme.dev', 'Security Lead'),
  ('22222222-2222-2222-2222-222222222204', 'Arjun Verma', 'arjun@acme.dev', 'Platform Engineer')
ON CONFLICT DO NOTHING;
