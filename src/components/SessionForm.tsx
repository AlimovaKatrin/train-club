'use client';
import {
  activityNames,
  duration,
  fieldSource,
  sourceNames,
  trustedSource,
  provenanceFields,
  type ProvenanceField,
  type Draft,
  type SessionInput,
} from '@/lib/domain';
import { NumberField } from './Fields';
import css from './Diary.module.css';
export function SessionForm({ draft, change }: { draft: Draft; change: (next: Draft) => void }) {
  const session = draft.input;
  const patch = (value: Partial<SessionInput>) => {
    const provenance = { ...session.provenance };
    for (const key of provenanceFields) {
      if (key in value) provenance[key] = value[key] === null ? 'unknown' : 'user_confirmed';
    }
    change({ ...draft, input: { ...session, ...value, provenance } });
  };
  const confirm = (fields: ProvenanceField[]) => {
    const provenance = { ...session.provenance };
    for (const field of fields) {
      provenance[field] = session[field] === null ? 'unknown' : 'user_confirmed';
    }
    change({ ...draft, input: { ...session, provenance } });
  };
  const source = (field: ProvenanceField, label: string) => (
    <div className={css.sourceHint}>
      <span>
        {session[field] === null ? 'Не указано' : sourceNames[fieldSource(session, field)]}
      </span>
      {session[field] !== null && !trustedSource(fieldSource(session, field)) && (
        <button type="button" className={css.textButton} onClick={() => confirm([field])}>
          Подтвердить {label}
        </button>
      )}
    </div>
  );
  if (draft.stage === 'prepare')
    return (
      <>
        <h1>Перед занятием</h1>
        <p className={css.subtitle}>
          {activityNames[session.activity]}
          {session.activity === 'gym'
            ? ` · тренировка ${draft.workout!.position} из ${draft.workout!.totalWorkouts}`
            : ''}
        </p>
        {session.activity === 'gym' && draft.workout?.notes && (
          <p className={css.small}>{draft.workout.notes}</p>
        )}
        <label className={css.field}>
          <span>Дата занятия</span>
          <input
            type="date"
            value={session.date}
            onChange={(e) => patch({ date: e.target.value })}
          />
        </label>
        <div className={css.field}>
          <span>Самочувствие перед занятием · 0–5</span>
          <div className={css.scale} role="group" aria-label="Самочувствие">
            {Array.from({ length: 6 }, (_, i) => (
              <button
                key={i}
                className={session.wellbeing === i ? css.selected : ''}
                aria-pressed={session.wellbeing === i}
                onClick={() => patch({ wellbeing: i })}
              >
                {i}
              </button>
            ))}
          </div>
        </div>
        <NumberField
          label="Сон, часов"
          value={session.sleep}
          step={0.5}
          max={24}
          onChange={(sleep) => patch({ sleep })}
        />
        {source('sleep', 'сон')}
        <p className={css.small}>
          Самочувствие сейчас и тяжесть после занятия — разные показатели.
        </p>
      </>
    );
  return (
    <>
      <h1>Как всё прошло?</h1>
      <p className={css.subtitle}>
        {activityNames[session.activity]} · {session.date}
        <br />
        Запиши время и ощущения.
      </p>
      {session.activity === 'gym' ? (
        <section className={css.section}>
          <h2>Продолжительность, мин</h2>
          {(
            [
              ['warmup', 'Разминка'],
              ['main', 'Основная часть'],
              ['cardio', 'Кардио после'],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className={css.timeRow}>
              <span>{label}</span>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={1440}
                step={1}
                value={session[key] ?? ''}
                onChange={(e) =>
                  patch({ [key]: e.target.value === '' ? null : Number(e.target.value) })
                }
              />
            </label>
          ))}
          {(['warmup', 'main', 'cardio'] as const).some(
            (key) => !trustedSource(fieldSource(session, key)),
          ) && (
            <button
              type="button"
              className={css.textButton}
              onClick={() => confirm(['warmup', 'main', 'cardio'])}
            >
              Подтвердить всё время зала
            </button>
          )}
          <p className={css.small}>
            Разминка: {sourceNames[fieldSource(session, 'warmup')]}. Основная часть:{' '}
            {sourceNames[fieldSource(session, 'main')]}. Кардио:{' '}
            {sourceNames[fieldSource(session, 'cardio')]}.
          </p>
          <div className={css.total}>
            <span>Всего</span>
            <strong>{duration(session)} мин</strong>
          </div>
        </section>
      ) : (
        <NumberField
          label="Продолжительность, мин"
          value={session.durationMinutes}
          min={1}
          max={1440}
          onChange={(durationMinutes) => patch({ durationMinutes })}
        />
      )}
      {session.activity !== 'gym' && source('durationMinutes', 'продолжительность')}
      <section className={css.section}>
        <h2>Измеренный пульс · необязательно</h2>
        <div className={css.two}>
          <NumberField
            label="Минимальный пульс"
            value={session.pulseMin}
            min={1}
            max={400}
            onChange={(n) => patch({ pulseMin: n })}
          />
          <NumberField
            label="Максимальный пульс"
            value={session.pulseMax}
            min={1}
            max={400}
            onChange={(n) => patch({ pulseMax: n })}
          />
        </div>
        {source('pulseMin', 'минимальный пульс')}
        {source('pulseMax', 'максимальный пульс')}
        <label className={css.field}>
          <span>Источник измерения пульса</span>
          <input
            value={session.pulseDevice ?? ''}
            maxLength={200}
            placeholder="Например, часы Garmin или вручную"
            onChange={(e) => patch({ pulseDevice: e.target.value || null })}
          />
        </label>
        <p className={css.small}>
          Если не измеряла — оставь поля пустыми. Неподтверждённый старый пульс не попадает в разбор
          как измерение.
        </p>
      </section>
      <label className={css.field}>
        <span>Тяжесть тренировки · 0–10</span>
        <select
          value={session.exertion < 0 ? '' : session.exertion}
          onChange={(e) => patch({ exertion: e.target.value === '' ? -1 : Number(e.target.value) })}
        >
          <option value="">Выбери значение</option>
          {Array.from({ length: 11 }, (_, i) => (
            <option key={i} value={i}>
              {i} / 10
            </option>
          ))}
        </select>
      </label>
      <label className={css.field}>
        <span>Заметка · необязательно</span>
        <textarea
          maxLength={5000}
          value={session.notes}
          onChange={(e) => patch({ notes: e.target.value })}
          placeholder="Что хочется запомнить?"
        />
      </label>
    </>
  );
}
