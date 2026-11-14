'use client';

import { useEffect, useId, useRef, useState } from 'react';
import {
  blankSet,
  formatPlan,
  formatSet,
  hasResults,
  optionSets,
  weightNames,
  workingProgress,
  type Draft,
  type ExerciseOption,
  type SetResult,
} from '@/lib/domain';
import { completeCurrentSet, nextPendingExercise, updateExerciseSets } from '@/lib/workout-draft';
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
  const option = draft.workout!.options.find((candidate) => candidate.id === exercise.optionId)!;
  const set = exercise.sets[draft.setIndex];
  const alternatives = draft.workout!.options.filter(
    (candidate) => candidate.position === option.position && candidate.id !== option.id,
  );
  const editing = draft.editingRevision !== null;
  const updateSets = (sets: SetResult[], setIndex = draft.setIndex) => {
    change(updateExerciseSets(draft, sets, setIndex));
  };
  const updateSet = (patch: Partial<SetResult>) => {
    const sets = exercise.sets.map((set, index) =>
      index === draft.setIndex ? { ...set, ...patch, done: false } : set,
    );
    updateSets(sets);
  };
  const mark = () => {
    let next: Draft;
    try {
      next = completeCurrentSet(draft);
    } catch (error) {
      onError((error as Error).message);
      return;
    }
    onError('');
    change(next);
  };
  const replace = (option: ExerciseOption) => {
    if (editing || hasResults(exercise.sets)) return;
    change({
      ...draft,
      setIndex: 0,
      input: {
        ...draft.input,
        exercises: draft.input.exercises.map((recordedExercise, index) =>
          index === draft.exerciseIndex
            ? { optionId: option.id, sets: optionSets(option) }
            : recordedExercise,
        ),
      },
    });
    setReplacing(false);
  };
  const completedWorkingSets = draft.input.exercises.reduce(
    (value, recordedExercise) => value + workingProgress(recordedExercise.sets),
    0,
  );
  const totalWorkingSets = draft.input.exercises.reduce(
    (value, recordedExercise) =>
      value + recordedExercise.sets.filter((result) => result.type === 'working').length,
    0,
  );
  const previousSet = exercise.sets[draft.setIndex - 1];
  const allDone = draft.input.exercises.every((recordedExercise) =>
    recordedExercise.sets.every((result) => result.done),
  );
  const exerciseDone = exercise.sets.every((result) => result.done);
  const nextPending = () => {
    const next = nextPendingExercise(draft);
    if (next !== draft) change(next);
  };
  let primaryAction = { label: '✓ Подход выполнен', onClick: mark };
  if (allDone) {
    primaryAction = { label: 'Перейти к итогам →', onClick: onFinish };
  } else if (exerciseDone) {
    primaryAction = { label: 'Следующее упражнение →', onClick: nextPending };
  }
  return (
    <>
      <div className={css.sectionHead}>
        <span className={css.small}>
          Упражнение {draft.exerciseIndex + 1} из {draft.input.exercises.length}
        </span>
        <span className={css.small}>
          {completedWorkingSets} из {totalWorkingSets} рабочих
        </span>
      </div>
      <div
        className={css.progress}
        role="progressbar"
        aria-label="Рабочие подходы"
        aria-valuemin={0}
        aria-valuemax={totalWorkingSets}
        aria-valuenow={completedWorkingSets}
      >
        <div style={{ width: `${(completedWorkingSets / totalWorkingSets) * 100}%` }} />
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
              onChange={(event) =>
                change({
                  ...draft,
                  input: {
                    ...draft.input,
                    exercises: draft.input.exercises.map((item, index) =>
                      index === draft.exerciseIndex
                        ? { ...item, equipmentNote: event.target.value || null }
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
          {!editing && alternatives.length > 0 && (
            <button
              className={css.textButton}
              disabled={hasResults(exercise.sets)}
              onClick={() => setReplacing(true)}
            >
              Заменить упражнение
            </button>
          )}
          {!editing && alternatives.length === 0 && (
            <p className={css.small}>Для этого упражнения в программе пока нет замен.</p>
          )}
          {!editing && alternatives.length > 0 && hasResults(exercise.sets) && (
            <p className={css.small}>Замена доступна до записи подходов.</p>
          )}
        </details>
        <div className={css.setTabs} role="group" aria-label="Подходы">
          {exercise.sets.map((result, index) => (
            <button
              key={`${result.type}-${result.position}`}
              className={`${index === draft.setIndex ? css.activeTab : ''} ${result.type === 'warmup' ? css.warmup : ''}`}
              aria-pressed={index === draft.setIndex}
              onClick={() => change({ ...draft, setIndex: index })}
            >
              {result.done ? '✓ ' : ''}
              {result.type === 'warmup' ? 'Разминка' : result.position}
              {result.type === 'working' && <small>рабочий</small>}
            </button>
          ))}
        </div>
        {set.type === 'working' && (
          <p className={css.subtitle}>
            План:{' '}
            {formatPlan(option.plan.find((plannedSet) => plannedSet.position === set.position)!)}
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
            onChange={(value) =>
              updateSet(option.measurement === 'reps' ? { reps: value } : { seconds: value })
            }
          />
        </div>
        {option.weightType !== 'none' && (
          <p className={css.small}>Пустой вес означает «неизвестен».</p>
        )}
        {!editing &&
          draft.setIndex === 0 &&
          !exercise.sets.some((result) => result.type === 'warmup' || result.done) && (
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
                exercise.sets.filter((result) => result.type !== 'warmup'),
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
          {draft.input.exercises.map((recordedExercise, index) => {
            const option = draft.workout!.options.find(
              (option) => option.id === recordedExercise.optionId,
            )!;
            const complete = recordedExercise.sets.every((result) => result.done);
            const current = index === draft.exerciseIndex;
            let exerciseStatus = 'Впереди';
            if (complete) exerciseStatus = 'Выполнено';
            else if (current) exerciseStatus = 'Сейчас';
            return (
              <button
                key={recordedExercise.optionId}
                className={css.row}
                aria-label={`Открыть упражнение ${index + 1}: ${option.name}${complete ? ' · выполнено' : ''}`}
                aria-current={current ? 'step' : undefined}
                onClick={() => {
                  setListOpen(false);
                  change({ ...draft, exerciseIndex: index, setIndex: 0 });
                }}
              >
                <span>
                  {index + 1}. {option.name}
                  <small>
                    {exerciseStatus} · {workingProgress(recordedExercise.sets)} из{' '}
                    {option.plan.length} рабочих
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

          <button className={css.primary} onClick={primaryAction.onClick}>
            {primaryAction.label}
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
          {alternatives.map((option) => (
            <button key={option.id} className={css.alternative} onClick={() => replace(option)}>
              <strong>{option.name}</strong>
              <small>
                {option.equipment} · {option.plan.map(formatPlan).join(' / ')}
                {option.perSide ? ' · на каждую сторону' : ''}
              </small>
            </button>
          ))}
        </div>
      </dialog>
    </>
  );
}
