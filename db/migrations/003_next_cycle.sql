-- Preserve the eight-workout programs; only new versions opt into 16 and a new loop start.
ALTER TABLE programs ADD COLUMN workout_count integer NOT NULL DEFAULT 8 CHECK (workout_count IN (8,16));
ALTER TABLE programs ADD COLUMN repeat_from integer NOT NULL DEFAULT 1;
ALTER TABLE programs DROP CONSTRAINT programs_next_position_check;
ALTER TABLE programs ADD CONSTRAINT programs_next_position_check CHECK (next_position BETWEEN 1 AND workout_count);
ALTER TABLE programs ADD CONSTRAINT programs_repeat_from_check CHECK (repeat_from BETWEEN 1 AND workout_count);
ALTER TABLE workout_templates DROP CONSTRAINT workout_templates_position_check;
ALTER TABLE workout_templates ADD CONSTRAINT workout_templates_position_check CHECK (position BETWEEN 1 AND 16);

-- The original seconds column remains the lower bound. NULL maximum means exact time.
ALTER TABLE workout_planned_sets ADD COLUMN target_duration_seconds_max integer;
ALTER TABLE workout_planned_sets ADD CONSTRAINT planned_duration_range_check CHECK (
  target_duration_seconds_max IS NULL OR
  (target_duration_seconds IS NOT NULL AND target_duration_seconds_max >= target_duration_seconds)
);
ALTER TABLE session_sets ADD COLUMN target_duration_seconds_max integer;
ALTER TABLE session_sets ADD CONSTRAINT session_duration_range_check CHECK (
  target_duration_seconds_max IS NULL OR
  (target_duration_seconds IS NOT NULL AND target_duration_seconds > 0
    AND target_duration_seconds_max >= target_duration_seconds
    AND target_reps_min IS NULL AND target_reps_max IS NULL)
);

CREATE OR REPLACE FUNCTION validate_program() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE'
    AND OLD.status <> 'draft'
    AND (NEW.name <> OLD.name
      OR NEW.version <> OLD.version
      OR NEW.status = 'draft'
      OR NEW.workout_count <> OLD.workout_count
      OR NEW.repeat_from <> OLD.repeat_from)
  THEN
    RAISE EXCEPTION 'Published programs are immutable; create a new version';
  END IF;
  IF NEW.status = 'published' THEN
    IF (SELECT count(*) FROM workout_templates WHERE program_id=NEW.id) <> NEW.workout_count
      OR (SELECT min(position) FROM workout_templates WHERE program_id=NEW.id) <> 1
      OR (SELECT max(position) FROM workout_templates WHERE program_id=NEW.id) <> NEW.workout_count
    THEN
      RAISE EXCEPTION 'Program requires % consecutive workouts', NEW.workout_count;
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
