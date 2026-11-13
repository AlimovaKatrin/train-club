export async function content(client, programId) {
  const templates = (
    await client.query('SELECT * FROM workout_templates WHERE program_id=$1 ORDER BY position', [
      programId,
    ])
  ).rows;
  const result = [];
  for (const template of templates) {
    const options = (
      await client.query(
        `SELECT o.*, e.name, e.equipment, e.measurement_type, e.weight_type, e.per_side, e.instructions
          FROM workout_exercise_options o
          JOIN exercises e ON e.id=o.exercise_id
          WHERE o.workout_template_id=$1
          ORDER BY o.position, o.is_primary DESC, o.exercise_id`,
        [template.id],
      )
    ).rows;
    const exerciseOptions = [];
    for (const option of options) {
      const sets = (
        await client.query(
          'SELECT * FROM workout_planned_sets WHERE exercise_option_id=$1 ORDER BY position',
          [option.id],
        )
      ).rows;
      exerciseOptions.push({
        position: option.position,
        exerciseId: option.exercise_id,
        name: option.name,
        equipment: option.equipment,
        measurement: option.measurement_type,
        weightType: option.weight_type,
        perSide: option.per_side,
        instructions: option.instructions,
        primary: option.is_primary,
        notes: option.notes,
        plan: sets.map((plannedSet) => ({
          position: plannedSet.position,
          repsMin: plannedSet.target_reps_min,
          repsMax: plannedSet.target_reps_max,
          seconds: plannedSet.target_duration_seconds,
          secondsMax: plannedSet.target_duration_seconds_max ?? null,
        })),
      });
    }
    result.push({
      position: template.position,
      name: template.name,
      notes: template.notes,
      options: exerciseOptions,
    });
  }
  return result;
}
export async function insertOption(client, templateId, option) {
  const { rows } = await client.query(
    `INSERT INTO workout_exercise_options(workout_template_id, position, exercise_id, is_primary, notes)
      VALUES($1, $2, $3, $4, $5)
      RETURNING id`,
    [templateId, option.position, option.exerciseId, option.primary, option.notes],
  );
  for (const plannedSet of option.plan)
    await client.query(
      `INSERT INTO workout_planned_sets(exercise_option_id,
          position,
          target_reps_min,
          target_reps_max,
          target_duration_seconds,
          target_duration_seconds_max)
        VALUES($1, $2, $3, $4, $5, $6)`,
      [
        rows[0].id,
        plannedSet.position,
        plannedSet.repsMin,
        plannedSet.repsMax,
        plannedSet.seconds,
        plannedSet.secondsMax,
      ],
    );
}
