-- Keep the existing column and stored values; only remove the fixed-hour rule.
ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_check1;
ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_duration_check;
ALTER TABLE sessions ADD CONSTRAINT sessions_duration_check CHECK (
  (activity_type = 'gym' AND workout_template_id IS NOT NULL
    AND fixed_duration_minutes IS NULL
    AND warmup_minutes IS NOT NULL AND main_minutes IS NOT NULL AND cardio_minutes IS NOT NULL
    AND warmup_minutes >= 0 AND main_minutes >= 0 AND cardio_minutes >= 0
    AND warmup_minutes + main_minutes + cardio_minutes > 0)
  OR
  (activity_type <> 'gym' AND workout_template_id IS NULL
    AND fixed_duration_minutes IS NOT NULL AND fixed_duration_minutes BETWEEN 1 AND 1440
    AND warmup_minutes IS NULL AND main_minutes IS NULL AND cardio_minutes IS NULL)
);
COMMENT ON COLUMN sessions.fixed_duration_minutes IS
  'Editable total duration in minutes for boxing/pilates. NULL for gym; legacy column name retained.';
