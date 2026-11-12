export async function content(client, programId) {
  const templates = (
    await client.query('SELECT * FROM workout_templates WHERE program_id=$1 ORDER BY position', [
      programId,
    ])
  ).rows;
  const result = [];
  for (const t of templates) {
    const options = (
      await client.query(
        `SELECT o.*,e.name,e.equipment,e.measurement_type,e.weight_type,e.per_side,e.instructions
      FROM workout_exercise_options o JOIN exercises e ON e.id=o.exercise_id WHERE o.workout_template_id=$1
      ORDER BY o.position,o.is_primary DESC,o.exercise_id`,
        [t.id],
      )
    ).rows;
    const items = [];
    for (const o of options) {
      const sets = (
        await client.query(
          'SELECT * FROM workout_planned_sets WHERE exercise_option_id=$1 ORDER BY position',
          [o.id],
        )
      ).rows;
      items.push({
        position: o.position,
        exerciseId: o.exercise_id,
        name: o.name,
        equipment: o.equipment,
        measurement: o.measurement_type,
        weightType: o.weight_type,
        perSide: o.per_side,
        instructions: o.instructions,
        primary: o.is_primary,
        notes: o.notes,
        plan: sets.map((s) => ({
          position: s.position,
          repsMin: s.target_reps_min,
          repsMax: s.target_reps_max,
          seconds: s.target_duration_seconds,
          secondsMax: s.target_duration_seconds_max ?? null,
        })),
      });
    }
    result.push({ position: t.position, name: t.name, notes: t.notes, options: items });
  }
  return result;
}

export async function insertOption(client, templateId, option) {
  const { rows } = await client.query(
    `INSERT INTO workout_exercise_options(workout_template_id,position,exercise_id,is_primary,notes)
    VALUES($1,$2,$3,$4,$5) RETURNING id`,
    [templateId, option.position, option.exerciseId, option.primary, option.notes],
  );
  for (const s of option.plan)
    await client.query(
      `INSERT INTO workout_planned_sets(exercise_option_id,position,target_reps_min,target_reps_max,target_duration_seconds,target_duration_seconds_max)
    VALUES($1,$2,$3,$4,$5,$6)`,
      [rows[0].id, s.position, s.repsMin, s.repsMax, s.seconds, s.secondsMax],
    );
}
