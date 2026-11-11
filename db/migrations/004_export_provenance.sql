-- Missing provenance means unknown, including every historical row.
ALTER TABLE sessions ADD COLUMN provenance jsonb NOT NULL DEFAULT '{}'::jsonb
  CHECK (jsonb_typeof(provenance) = 'object');
ALTER TABLE sessions ADD COLUMN pulse_device text;
ALTER TABLE sessions ADD COLUMN workout_snapshot jsonb;
ALTER TABLE sessions ALTER COLUMN sleep_hours DROP NOT NULL;
ALTER TABLE sessions ALTER COLUMN heart_rate_min DROP NOT NULL;
ALTER TABLE sessions ALTER COLUMN heart_rate_max DROP NOT NULL;
ALTER TABLE session_exercises ADD COLUMN equipment_note text;
COMMENT ON COLUMN sessions.provenance IS 'Per-field source: user_confirmed, device, default, unknown. Missing keys are unknown; never inferred from a value.';
COMMENT ON COLUMN sessions.workout_snapshot IS 'Program version, workout and all exercise options/plans captured on initial save. Never replaced by a history edit.';
