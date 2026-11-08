-- User-provided A/B plan, including the seated/lying curl clarification.
-- Only exercises used by this program and its replacements are loaded here.
BEGIN;
LOCK TABLE programs, sessions IN SHARE ROW EXCLUSIVE MODE;
DO $$
DECLARE
  pid uuid; tid uuid; oid uuid; i integer; item record;
  program_name text := 'Силовые A/B · 8 тренировок';
BEGIN
  IF EXISTS (SELECT 1 FROM programs WHERE name=program_name AND version=1) THEN
    RETURN; -- Re-running the seed must preserve history and queue position.
  END IF;
  IF EXISTS (SELECT 1 FROM programs WHERE is_active
    AND name <> 'Демонстрационная программа · не согласована с тренером')
    OR EXISTS (SELECT 1 FROM sessions WHERE activity_type='gym') THEN
    RAISE EXCEPTION 'An existing personal program or gym history requires a separate version transition';
  END IF;

  CREATE TEMP TABLE personal_exercises (
    key text PRIMARY KEY, id uuid NOT NULL DEFAULT gen_random_uuid(),
    name text, equipment text, weight_type text, per_side boolean, instructions text
  ) ON COMMIT DROP;
  INSERT INTO personal_exercises(key,name,equipment,weight_type,per_side,instructions) VALUES
    ('goblet', 'Гоблет-присед', 'Одна гантель или гиря', 'total', false, 'Держи снаряд перед грудью и приседай в контролируемой амплитуде'),
    ('bench', 'Жим гантелей на горизонтальной скамье', 'Две гантели, горизонтальная скамья', 'dumbbell', false, 'Опусти гантели по сторонам груди и выжми вверх'),
    ('lat', 'Тяга верхнего блока к груди', 'Верхний блок, рукоять', 'machine', false, 'Тяни рукоять к верхней части груди, направляя локти вниз'),
    ('seated', 'Сгибание ног сидя', 'Тренажёр для сгибания ног сидя', 'machine', false, 'Сгибай колени, перемещая валик назад; работает задняя поверхность бедра Выполняй двумя ногами одновременно. Записывай выбранный вес тренажёра в килограммах. Вес для каждого тренажёра подбирай отдельно.'),
    ('bridge', 'Ягодичный мостик с гантелью', 'Коврик, гантель, мягкая прокладка', 'total', false, 'Плечи остаются на полу; придерживай гантель руками'),
    ('split', 'Сплит-присед с опорой и одной гантелью', 'Одна гантель, устойчивая опора', 'dumbbell', true, 'Свободной рукой держись за опору; положение гантели относительно рабочей ноги сохраняй одинаковым'),
    ('row', 'Тяга гантели одной рукой с опорой', 'Гантель, скамья или другая опора', 'dumbbell', true, 'Тяни локоть назад к тазу, избегая разворота корпуса'),
    ('lying', 'Сгибание ног лёжа', 'Тренажёр для сгибания ног лёжа', 'machine', false, 'Подводи пятки к ягодицам, сохраняя таз на подушке Выполняй двумя ногами одновременно. Записывай выбранный вес тренажёра в килограммах. Вес для каждого тренажёра подбирай отдельно.'),
    ('rdl', 'Румынская тяга с гантелями', 'Две гантели', 'dumbbell', false, 'Отводи таз назад, гантели веди близко к ногам; колени слегка согнуты'),
    ('floor', 'Жим гантелей лёжа на полу', 'Две гантели, коврик', 'dumbbell', false, 'Плечи мягко касаются пола в нижней точке, затем выжми гантели'),
    ('split_body', 'Сплит-присед с опорой без гантели', 'Устойчивая опора', 'none', true, 'Стопы стоят в разножке и не переставляются между повторами Держись рукой за опору.');
  INSERT INTO exercises(id,name,equipment,measurement_type,weight_type,per_side,instructions)
    SELECT id,name,equipment,'reps',weight_type,per_side,instructions FROM personal_exercises;
  INSERT INTO programs(name,version) VALUES (program_name,1) RETURNING id INTO pid;
  FOR i IN 1..8 LOOP
    INSERT INTO workout_templates(program_id,position,name,notes)
      VALUES (pid,i,'Тренировка '||i||' · '||CASE WHEN i%2=1 THEN 'A' ELSE 'B' END,
        'Четыре недели по две силовые. Разминка 8–10 минут. Все подходы в плане — рабочие. '
        'Подбирай вес примерно с тремя повторениями в запасе. Между силовыми — хотя бы один день без силовой тренировки. '
        'Когда на двух занятиях подряд достигаешь верхней границы в обоих подходах с нужным запасом и контролем, попробуй минимальную прибавку веса. '
        'В сплит-приседе ориентир — уверенные 8 повторений на каждую ногу.')
      RETURNING id INTO tid;
    FOR item IN
      SELECT v.*,e.id AS exercise_id FROM (VALUES
        ('A',1,'goblet',true,8,12,'Отдых около 2 минут.'),
        ('B',1,'split',true,8,8,'Выполни обе стороны, затем отдых около 2 минут.'),
        ('B',1,'split_body',false,8,8,'Если трудно удерживать равновесие с весом. Выполни обе стороны, затем отдых около 2 минут.'),
        ('*',2,'bench',true,8,12,'Отдых около 2 минут.'),
        ('*',2,'floor',false,8,12,'Если нет горизонтальной скамьи. Отдых около 2 минут.'),
        ('A',3,'lat',true,10,12,'Отдых около 2 минут.'),
        ('A',3,'row',false,10,12,'Если нет верхнего блока. Выполни обе стороны, затем отдых около 2 минут.'),
        ('B',3,'row',true,10,12,'Выполни обе стороны, затем отдых около 2 минут.'),
        ('*',4,'seated',true,12,15,'Отдых 60–90 секунд.'),
        ('*',4,'lying',false,12,15,'Если нет сидячего тренажёра или его настройка неудобна. Отдых 60–90 секунд.'),
        ('*',4,'rdl',false,8,10,'Если нет тренажёров для сгибания ног; после освоения движения с тренером. Отдых около 2 минут.'),
        ('*',5,'bridge',true,12,15,'Отдых 60–90 секунд.')
      ) AS v(kind,position,key,is_primary,reps_min,reps_max,notes)
      JOIN personal_exercises e ON e.key=v.key
      WHERE v.kind='*' OR v.kind=CASE WHEN i%2=1 THEN 'A' ELSE 'B' END
    LOOP
      INSERT INTO workout_exercise_options(workout_template_id,position,exercise_id,is_primary,notes)
        VALUES(tid,item.position,item.exercise_id,item.is_primary,item.notes||' Запас — около 3 повторений.')
        RETURNING id INTO oid;
      INSERT INTO workout_planned_sets(exercise_option_id,position,target_reps_min,target_reps_max)
        VALUES(oid,1,item.reps_min,item.reps_max),(oid,2,item.reps_min,item.reps_max);
    END LOOP;
  END LOOP;
  -- Preserve the demo rows; activating the personal plan invalidates stale demo submissions.
  UPDATE programs SET is_active=false,revision=revision+1 WHERE is_active;
  UPDATE programs SET status='published',is_active=true WHERE id=pid;
END $$;
COMMIT;
