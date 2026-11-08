-- Run as PostgreSQL administrator after migrations. The runtime role already
-- exists with a separate password; it is not a table owner or a superuser.
REVOKE ALL ON DATABASE train_club FROM PUBLIC;
GRANT CONNECT ON DATABASE train_club TO train_club_app, train_club_migrate;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO train_club_app;
GRANT SELECT ON exercises, programs, workout_templates, workout_exercise_options,
  workout_planned_sets, sessions, session_exercises, session_sets TO train_club_app;
GRANT INSERT, UPDATE, DELETE ON sessions, session_exercises, session_sets TO train_club_app;
GRANT UPDATE (next_position, revision) ON programs TO train_club_app;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['exercises','programs','workout_templates',
    'workout_exercise_options','workout_planned_sets','sessions','session_exercises','session_sets'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=t AND policyname='runtime_access') THEN
      EXECUTE format('CREATE POLICY runtime_access ON %I TO train_club_app USING (true) WITH CHECK (true)', t);
    END IF;
  END LOOP;
END $$;
