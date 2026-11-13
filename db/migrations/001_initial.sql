BEGIN;
CREATE TABLE exercises (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  equipment text NOT NULL,
  measurement_type text NOT NULL CHECK (measurement_type IN ('reps','time')),
  weight_type text NOT NULL CHECK (weight_type IN ('dumbbell','total','machine','none')),
  per_side boolean NOT NULL DEFAULT false,
  instructions text NOT NULL DEFAULT '',
  archived_at timestamptz
);
CREATE TABLE programs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  is_active boolean NOT NULL DEFAULT false,
  next_position integer NOT NULL DEFAULT 1 CHECK (next_position BETWEEN 1 AND 8),
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  UNIQUE(name,version),
  CHECK (NOT is_active OR status = 'published')
);
CREATE UNIQUE INDEX one_active_program ON programs(is_active) WHERE is_active;
CREATE TABLE workout_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id uuid NOT NULL REFERENCES programs(id),
  position integer NOT NULL CHECK (position BETWEEN 1 AND 8),
  name text NOT NULL,
  notes text NOT NULL DEFAULT '',
  UNIQUE(program_id,position)
);
CREATE TABLE workout_exercise_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workout_template_id uuid NOT NULL REFERENCES workout_templates(id),
  position integer NOT NULL CHECK (position > 0),
  exercise_id uuid NOT NULL REFERENCES exercises(id),
  is_primary boolean NOT NULL DEFAULT false,
  notes text NOT NULL DEFAULT '',
  UNIQUE(workout_template_id,position,exercise_id)
);
CREATE UNIQUE INDEX one_primary_per_slot ON workout_exercise_options(workout_template_id,position) WHERE is_primary;
CREATE TABLE workout_planned_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exercise_option_id uuid NOT NULL REFERENCES workout_exercise_options(id),
  position integer NOT NULL CHECK (position > 0),
  target_reps_min integer,
  target_reps_max integer,
  target_duration_seconds integer,
  UNIQUE(exercise_option_id,position),
  CHECK ((target_reps_min IS NOT NULL AND target_reps_max IS NOT NULL AND target_reps_min > 0 AND target_reps_max >= target_reps_min AND target_duration_seconds IS NULL)
    OR (target_reps_min IS NULL AND target_reps_max IS NULL AND target_duration_seconds IS NOT NULL AND target_duration_seconds > 0))
);
CREATE TABLE sessions (
  id uuid PRIMARY KEY,
  activity_type text NOT NULL CHECK (activity_type IN ('gym','pilates','boxing')),
  performed_on date NOT NULL,
  workout_template_id uuid REFERENCES workout_templates(id),
  wellbeing integer NOT NULL CHECK (wellbeing BETWEEN 0 AND 5),
  sleep_hours numeric NOT NULL CHECK (sleep_hours BETWEEN 0 AND 24),
  warmup_minutes integer,
  main_minutes integer,
  cardio_minutes integer,
  fixed_duration_minutes integer,
  heart_rate_min integer NOT NULL CHECK (heart_rate_min > 0),
  heart_rate_max integer NOT NULL CHECK (heart_rate_max >= heart_rate_min),
  exertion integer NOT NULL CHECK (exertion BETWEEN 0 AND 10),
  notes text NOT NULL DEFAULT '',
  request_hash text NOT NULL,
  revision integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((activity_type = 'gym' AND workout_template_id IS NOT NULL AND fixed_duration_minutes IS NULL
    AND warmup_minutes IS NOT NULL AND main_minutes IS NOT NULL AND cardio_minutes IS NOT NULL
    AND warmup_minutes >= 0 AND main_minutes >= 0 AND cardio_minutes >= 0 AND warmup_minutes + main_minutes + cardio_minutes > 0)
    OR (activity_type <> 'gym' AND workout_template_id IS NULL AND fixed_duration_minutes = 60
      AND warmup_minutes IS NULL AND main_minutes IS NULL AND cardio_minutes IS NULL))
);
CREATE TABLE session_exercises (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES sessions(id),
  exercise_option_id uuid NOT NULL REFERENCES workout_exercise_options(id),
  exercise_id uuid NOT NULL REFERENCES exercises(id),
  position integer NOT NULL CHECK (position > 0),
  name text NOT NULL,
  equipment text NOT NULL,
  measurement_type text NOT NULL CHECK (measurement_type IN ('reps','time')),
  weight_type text NOT NULL CHECK (weight_type IN ('dumbbell','total','machine','none')),
  per_side boolean NOT NULL,
  instructions text NOT NULL,
  UNIQUE(session_id,position)
);
CREATE TABLE session_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_exercise_id uuid NOT NULL REFERENCES session_exercises(id),
  set_type text NOT NULL CHECK (set_type IN ('working','warmup')),
  position integer NOT NULL CHECK (position > 0),
  target_reps_min integer,
  target_reps_max integer,
  target_duration_seconds integer,
  weight_kg numeric CHECK (weight_kg >= 0),
  reps integer CHECK (reps > 0),
  duration_seconds integer CHECK (duration_seconds > 0),
  status text NOT NULL CHECK (status IN ('done','unrecorded')),
  UNIQUE(session_exercise_id,set_type,position),
  CHECK (set_type <> 'warmup' OR position = 1),
  CHECK (status <> 'done' OR ((reps IS NOT NULL AND duration_seconds IS NULL) OR (reps IS NULL AND duration_seconds IS NOT NULL)))
);
CREATE INDEX sessions_history ON sessions(performed_on DESC,created_at DESC);
CREATE INDEX previous_exercises ON session_exercises(exercise_id,session_id);

CREATE FUNCTION validate_program() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE'
    AND OLD.status <> 'draft'
    AND (NEW.name <> OLD.name
      OR NEW.version <> OLD.version
      OR NEW.status = 'draft')
  THEN
    RAISE EXCEPTION 'Published programs are immutable; create a new version';
  END IF;
  IF NEW.status = 'published' THEN
    IF (SELECT count(*) FROM workout_templates WHERE program_id=NEW.id) <> 8 THEN
      RAISE EXCEPTION 'Eight workouts are required';
    END IF;
    IF EXISTS (
      SELECT 1 FROM workout_templates t
      WHERE t.program_id=NEW.id
        AND NOT EXISTS (
          SELECT 1 FROM workout_exercise_options o
          WHERE o.workout_template_id=t.id
        )
    ) THEN
      RAISE EXCEPTION 'Empty workout';
    END IF;
    IF EXISTS (
      SELECT 1 FROM workout_exercise_options o
      JOIN workout_templates t ON t.id=o.workout_template_id
      WHERE t.program_id=NEW.id
      GROUP BY o.workout_template_id,o.position
      HAVING count(*) FILTER (WHERE o.is_primary) <> 1
    ) THEN
      RAISE EXCEPTION 'Primary option is required';
    END IF;
    IF EXISTS (
      SELECT 1 FROM workout_exercise_options o
      JOIN workout_templates t ON t.id=o.workout_template_id
      WHERE t.program_id=NEW.id
        AND NOT EXISTS (
          SELECT 1 FROM workout_planned_sets s
          WHERE s.exercise_option_id=o.id
        )
    ) THEN
      RAISE EXCEPTION 'Every option needs a plan';
    END IF;
    IF EXISTS (
      SELECT 1 FROM workout_planned_sets s
      JOIN workout_exercise_options o ON o.id=s.exercise_option_id
      JOIN workout_templates t ON t.id=o.workout_template_id
      JOIN exercises e ON e.id=o.exercise_id
      WHERE t.program_id=NEW.id
        AND ((e.measurement_type='time') <> (s.target_duration_seconds IS NOT NULL))
    ) THEN
      RAISE EXCEPTION 'Plan measurement mismatch';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER validate_program BEFORE INSERT OR UPDATE ON programs FOR EACH ROW EXECUTE FUNCTION validate_program();

CREATE FUNCTION guard_program_content() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  item record;
  pid uuid;
  state text;
BEGIN
  -- Check BOTH parents on a move so content cannot be stolen from a published version.
  FOR item IN
    SELECT v.* FROM (
      VALUES
        (CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END),
        (CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END)
    ) v(data)
    WHERE v.data IS NOT NULL
  LOOP
    IF TG_TABLE_NAME='workout_templates' THEN
      pid := (item.data->>'program_id')::uuid;
    ELSIF TG_TABLE_NAME='workout_exercise_options' THEN
      SELECT program_id INTO pid FROM workout_templates
      WHERE id=(item.data->>'workout_template_id')::uuid;
    ELSE
      SELECT t.program_id INTO pid FROM workout_exercise_options o
      JOIN workout_templates t ON t.id=o.workout_template_id
      WHERE o.id=(item.data->>'exercise_option_id')::uuid;
    END IF;
    SELECT status INTO state FROM programs WHERE id=pid FOR SHARE;
    IF state <> 'draft' THEN
      RAISE EXCEPTION 'Published program content is immutable';
    END IF;
  END LOOP;
  IF TG_OP='DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_templates BEFORE INSERT OR UPDATE OR DELETE ON workout_templates FOR EACH ROW EXECUTE FUNCTION guard_program_content();
CREATE TRIGGER guard_options BEFORE INSERT OR UPDATE OR DELETE ON workout_exercise_options FOR EACH ROW EXECUTE FUNCTION guard_program_content();
CREATE TRIGGER guard_plans BEFORE INSERT OR UPDATE OR DELETE ON workout_planned_sets FOR EACH ROW EXECUTE FUNCTION guard_program_content();

-- Server connects as table owner. Supabase browser roles receive no policies or access.
DO $$
DECLARE
  t text;
  r text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'exercises','programs','workout_templates','workout_exercise_options',
    'workout_planned_sets','sessions','session_exercises','session_sets'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('REVOKE ALL ON %I FROM PUBLIC',t);
    FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=r) THEN
        EXECUTE format('REVOKE ALL ON %I FROM %I',t,r);
      END IF;
    END LOOP;
  END LOOP;
END $$;
COMMIT;
