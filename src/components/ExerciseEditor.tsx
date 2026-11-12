'use client';
import { useEffect, useId, useRef, useState } from 'react';
import {
  blankSet,
  formatPlan,
  formatSet,
  hasResults,
  optionSets,
  setSchema,
  weightNames,
  workingProgress,
  type Draft,
  type ExerciseOption,
  type SetResult,
} from '@/lib/domain';
import { NumberField } from './Fields';
import { ExerciseTechnique } from './ExerciseTechnique';
import css from './Diary.module.css';
export function ExerciseEditor({
  draft,
  change,
  onError,
  onFinish,
  status,
  error,
}: {
  draft: Draft;
  change: (next: Draft) => void;
  onError: (message: string) => void;
  onFinish: () => void;
  status: string;
  error: string;
}) {
  const [replacing, setReplacing] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const listId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (replacing) dialog.current?.showModal();
    else dialog.current?.close();
  }, [replacing]);
  const exercise = draft.input.exercises[draft.exerciseIndex];
  const option = draft.workout!.options.find((o) => o.id === exercise.optionId)!;
  const set = exercise.sets[draft.setIndex];
  const alternatives = draft.workout!.options.filter(
    (o) => o.position === option.position && o.id !== option.id,
  );
  const editing = draft.editingRevision !== null;
  const updateSets = (
    sets: SetResult[],
    index = draft.setIndex,
    exerciseIndex = draft.exerciseIndex,
  ) =>
    change({
      ...draft,
      exerciseIndex,
      setIndex: index,
      input: {
        ...draft.input,
        exercises: draft.input.exercises.map((e, i) =>
          i === draft.exerciseIndex ? { ...e, sets } : e,
        ),
      },
    });
  const updateSet = (patch: Partial<SetResult>) =>
    updateSets(
      exercise.sets.map((s, i) => (i === draft.setIndex ? { ...s, ...patch, done: false } : s)),
    );
  const mark = () => {
    const result = setSchema.safeParse({ ...set, done: true });
    if (
      !result.success ||
      (option.measurement === 'reps' ? set.reps === null : set.seconds === null)
    ) {
      onError(
        'Укажи целое положительное число повторений или секунд. Вес можно оставить неизвестным.',
      );
      return;
    }
    onError('');
    const sets = exercise.sets.map((s, i) => (i === draft.setIndex ? { ...s, done: true } : s));
    if (editing) {
      updateSets(sets, Math.min(draft.setIndex + 1, sets.length - 1));
      return;
    }
    const pending = sets.findIndex((s) => !s.done);
    if (pending !== -1) {
      const next = sets.findIndex((s, i) => i > draft.setIndex && !s.done);
      updateSets(sets, next !== -1 ? next : pending);
      return;
    }
    const nextExercise = draft.input.exercises[draft.exerciseIndex + 1];
    if (nextExercise) {
      updateSets(
        sets,
        Math.max(
          0,
          nextExercise.sets.findIndex((s) => !s.done),
        ),
        draft.exerciseIndex + 1,
      );
    } else updateSets(sets);
  };
  const replace = (o: ExerciseOption) => {
    if (editing || hasResults(exercise.sets)) return;
    change({
      ...draft,
      setIndex: 0,
      input: {
        ...draft.input,
        exercises: draft.input.exercises.map((e, i) =>
          i === draft.exerciseIndex ? { optionId: o.id, sets: optionSets(o) } : e,
        ),
      },
    });
    setReplacing(false);
  };
  const done = draft.input.exercises.reduce((n, e) => n + workingProgress(e.sets), 0);
  const total = draft.input.exercises.reduce(
    (n, e) => n + e.sets.filter((s) => s.type === 'working').length,
    0,
  );
  const previousSet = exercise.sets[draft.setIndex - 1];
  const allDone = draft.input.exercises.every((e) => e.sets.every((s) => s.done));
  const exerciseDone = exercise.sets.every((s) => s.done);
  const nextPending = () => {
    const next = draft.input.exercises.findIndex(
      (e, i) => i > draft.exerciseIndex && e.sets.some((s) => !s.done),
    );
    const index =
      next === -1 ? draft.input.exercises.findIndex((e) => e.sets.some((s) => !s.done)) : next;
    if (index !== -1)
      change({
        ...draft,
        exerciseIndex: index,
        setIndex: draft.input.exercises[index].sets.findIndex((s) => !s.done),
      });
  };
  return (
    <>
      <div className={css.sectionHead}>
        <span className={css.small}>
          Упражнение {draft.exerciseIndex + 1} из {draft.input.exercises.length}
        </span>
        <span className={css.small}>
          {done} из {total} рабочих
        </span>
      </div>
      <div
        className={css.progress}
        role="progressbar"
        aria-label="Рабочие подходы"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
      >
        <div style={{ width: `${(done / total) * 100}%` }} />
      </div>
      <div className={`${css.card} ${css.exerciseCard}`}>
        <h1>{option.name}</h1>
        <p className={css.subtitle}>
          {weightNames[option.weightType]}
          {option.perSide ? ' · на каждую сторону' : ''}
        </p>
        <details className={css.exerciseDetails} key={option.id}>
          <summary>Техника и прошлый результат</summary>
          <ExerciseTechnique key={option.id} exerciseId={option.exerciseId} name={option.name} />
          {option.instructions && <p className={css.small}>{option.instructions}</p>}
          <p className={css.small}>{option.equipment}</p>
          <label className={css.field}>
            <span>Модель тренажёра или заметка об оборудовании</span>
            <input
              value={exercise.equipmentNote ?? ''}
              maxLength={300}
              placeholder="Необязательно, например номер тренажёра"
              onChange={(e) =>
                change({
                  ...draft,
                  input: {
                    ...draft.input,
                    exercises: draft.input.exercises.map((item, i) =>
                      i === draft.exerciseIndex
                        ? { ...item, equipmentNote: e.target.value || null }
                        : item,
                    ),
                  },
                })
              }
            />
          </label>
          <div className={css.previous}>
            В прошлый раз:{' '}
            {option.previous ? (
              <>
                <strong>{option.previous.date}</strong> ·{' '}
                {option.previous.sets.map(formatSet).join(' · ')}
              </>
            ) : (
              'предыдущих результатов пока нет'
            )}
          </div>
          {!editing && (
            <button
              className={css.textButton}
              disabled={!alternatives.length || hasResults(exercise.sets)}
              onClick={() => setReplacing(true)}
            >
              Заменить упражнение
            </button>
          )}
          {!editing && hasResults(exercise.sets) && (
            <p className={css.small}>Замена доступна до записи подходов.</p>
          )}
        </details>
        <div className={css.setTabs} role="group" aria-label="Подходы">
          {exercise.sets.map((s, i) => (
            <button
              key={`${s.type}-${s.position}`}
              className={`${i === draft.setIndex ? css.activeTab : ''} ${s.type === 'warmup' ? css.warmup : ''}`}
              aria-pressed={i === draft.setIndex}
              onClick={() => change({ ...draft, setIndex: i })}
            >
              {s.done ? '✓ ' : ''}
              {s.type === 'warmup' ? 'Разминка' : s.position}
              {s.type === 'working' && <small>рабочий</small>}
            </button>
          ))}
        </div>
        {set.type === 'working' && (
          <p className={css.subtitle}>
            План: {formatPlan(option.plan.find((p) => p.position === set.position)!)}
            {option.perSide ? ' на каждую сторону' : ''}
          </p>
        )}
        <div className={option.weightType === 'none' ? '' : css.two}>
          {option.weightType !== 'none' && (
            <NumberField
              label="Вес, кг"
              value={set.weight}
              step={0.5}
              onChange={(weight) => updateSet({ weight })}
            />
          )}
          <NumberField
            label={option.measurement === 'reps' ? 'Повторения' : 'Длительность, сек'}
            value={option.measurement === 'reps' ? set.reps : set.seconds}
            min={1}
            onChange={(n) =>
              updateSet(option.measurement === 'reps' ? { reps: n } : { seconds: n })
            }
          />
        </div>
        {option.weightType !== 'none' && (
          <p className={css.small}>Пустой вес означает «неизвестен».</p>
        )}
        {!editing &&
          draft.setIndex === 0 &&
          !exercise.sets.some((s) => s.type === 'warmup' || s.done) && (
            <button
              className={css.textButton}
              onClick={() => updateSets([blankSet(1, 'warmup'), ...exercise.sets], 0)}
            >
              + Добавить разминочный подход
            </button>
          )}
        {set.type === 'warmup' && !set.done && !editing && (
          <button
            className={css.textButton}
            onClick={() =>
              updateSets(
                exercise.sets.filter((s) => s.type !== 'warmup'),
                0,
              )
            }
          >
            Убрать незаписанную разминку
          </button>
        )}
      </div>
      <nav className={css.exerciseList} aria-label="Упражнения тренировки">
        <button
          className={css.exerciseListToggle}
          aria-expanded={listOpen}
          aria-controls={listId}
          onClick={() => setListOpen(!listOpen)}
        >
          <span>{listOpen ? 'Скрыть список упражнений' : 'Показать список упражнений'}</span>
          <span aria-hidden="true">{listOpen ? '▴' : '▾'}</span>
        </button>
        <div id={listId} hidden={!listOpen}>
          {draft.input.exercises.map((e, i) => {
            const o = draft.workout!.options.find((o) => o.id === e.optionId)!;
            const complete = e.sets.every((s) => s.done);
            const current = i === draft.exerciseIndex;
            return (
              <button
                key={e.optionId}
                className={css.row}
                aria-label={`Открыть упражнение ${i + 1}: ${o.name}${complete ? ' · выполнено' : ''}`}
                aria-current={current ? 'step' : undefined}
                onClick={() => {
                  setListOpen(false);
                  change({ ...draft, exerciseIndex: i, setIndex: 0 });
                }}
              >
                <span>
                  {i + 1}. {o.name}
                  <small>
                    {complete ? 'Выполнено' : current ? 'Сейчас' : 'Впереди'} ·{' '}
                    {workingProgress(e.sets)} из {o.plan.length} рабочих
                  </small>
                </span>
                <span aria-hidden="true">{complete ? '✓' : '›'}</span>
              </button>
            );
          })}
        </div>
      </nav>
      <footer
        className={`${css.actionbar} ${css.workoutActions}`}
        role="group"
        aria-label="Действия подхода"
      >
        {error && (
          <div className={css.error} role="alert">
            {error}
          </div>
        )}
        <div className={css.workoutButtons}>
          {!allDone &&
            !exerciseDone &&
            set.type === 'working' &&
            previousSet?.type === 'working' && (
              <button
                className={css.secondary}
                aria-label="Скопировать предыдущий подход"
                disabled={!previousSet.done}
                onClick={() =>
                  updateSet({
                    weight: previousSet.weight,
                    reps: previousSet.reps,
                    seconds: previousSet.seconds,
                  })
                }
              >
                Скопировать
              </button>
            )}

          <button
            className={css.primary}
            onClick={allDone ? onFinish : exerciseDone ? nextPending : mark}
          >
            {allDone
              ? 'Перейти к итогам →'
              : exerciseDone
                ? 'Следующее упражнение →'
                : '✓ Подход выполнен'}
          </button>
        </div>
        <p className={css.status} role="status">
          {status}
        </p>
      </footer>
      <dialog ref={dialog} className={css.nativeDialog} onCancel={() => setReplacing(false)}>
        <div className={css.sheet}>
          <div className={css.sectionHead}>
            <h2>Заменить упражнение</h2>
            <button aria-label="Закрыть замены" onClick={() => setReplacing(false)}>
              ✕
            </button>
          </div>
          <p className={css.small}>Замена только для этого занятия. Вес не переносится.</p>
          {alternatives.map((o) => (
            <button key={o.id} className={css.alternative} onClick={() => replace(o)}>
              <strong>{o.name}</strong>
              <small>
                {o.equipment} · {o.plan.map(formatPlan).join(' / ')}
                {o.perSide ? ' · на каждую сторону' : ''}
              </small>
            </button>
          ))}
        </div>
      </dialog>
    </>
  );
}
