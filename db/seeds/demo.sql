-- DEMO ONLY: repeated examples to test the eight-position queue, not a training prescription.
BEGIN;
DO $$
DECLARE pid uuid; tid uuid; eid uuid; aid uuid; timed uuid; oid uuid; i integer;
BEGIN
  IF EXISTS (SELECT 1 FROM programs WHERE is_active) THEN RAISE EXCEPTION 'Refusing to seed over an active program'; END IF;
  INSERT INTO programs(name,version) VALUES ('Демонстрационная программа · не согласована с тренером',1) RETURNING id INTO pid;
  INSERT INTO exercises(name,equipment,measurement_type,weight_type) VALUES ('Тяга нижнего блока','Блочный тренажёр','reps','machine') RETURNING id INTO eid;
  INSERT INTO exercises(name,equipment,measurement_type,weight_type,per_side) VALUES ('Тяга гантели с упором','Гантель и скамья','reps','dumbbell',true) RETURNING id INTO aid;
  INSERT INTO exercises(name,equipment,measurement_type,weight_type) VALUES ('Планка на предплечьях','Коврик','time','none') RETURNING id INTO timed;
  FOR i IN 1..8 LOOP
    INSERT INTO workout_templates(program_id,position,name) VALUES (pid,i,'Демо · тренировка '||i) RETURNING id INTO tid;
    INSERT INTO workout_exercise_options(workout_template_id,position,exercise_id,is_primary) VALUES (tid,1,eid,true) RETURNING id INTO oid;
    INSERT INTO workout_planned_sets(exercise_option_id,position,target_reps_min,target_reps_max) VALUES (oid,1,12,12),(oid,2,10,12),(oid,3,10,10);
    INSERT INTO workout_exercise_options(workout_template_id,position,exercise_id,is_primary) VALUES (tid,1,aid,false) RETURNING id INTO oid;
    INSERT INTO workout_planned_sets(exercise_option_id,position,target_reps_min,target_reps_max) VALUES (oid,1,12,12),(oid,2,12,12);
    INSERT INTO workout_exercise_options(workout_template_id,position,exercise_id,is_primary) VALUES (tid,2,timed,true) RETURNING id INTO oid;
    INSERT INTO workout_planned_sets(exercise_option_id,position,target_duration_seconds) VALUES (oid,1,30),(oid,2,40);
  END LOOP;
  UPDATE programs SET status='published',is_active=true WHERE id=pid;
END $$;
COMMIT;
