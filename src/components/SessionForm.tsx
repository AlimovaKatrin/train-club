'use client';
import {
  activityNames,
  duration,
  fieldSource,
  sourceNames,
  provenanceFields,
  type ProvenanceField,
  type Draft,
  type SessionInput,
} from '@/lib/domain';
import { NumberField } from './Fields';
import css from './Diary.module.css';
export function SessionForm({ draft, change }: { draft: Draft; change: (next: Draft) => void }) {
  const s = draft.input;
  const patch = (value: Partial<SessionInput>) => {
    const provenance = { ...s.provenance };
    for (const key of provenanceFields) {
      if (key in value) provenance[key] = value[key] === null ? 'unknown' : 'user_confirmed';
    }
    change({ ...draft, input: { ...s, ...value, provenance } });
  };
  const confirm = (fields: ProvenanceField[]) =>
    change({
      ...draft,
      input: {
        ...s,
        provenance: {
          ...s.provenance,
          ...Object.fromEntries(
            fields.map((key) => [key, s[key] === null ? 'unknown' : 'user_confirmed']),
          ),
        },
      },
    });
  const source = (field: ProvenanceField, label: string) => (
    <div className={css.sourceHint}>
      <span>{s[field] === null ? 'Не указано' : sourceNames[fieldSource(s, field)]}</span>
      {s[field] !== null && !['user_confirmed', 'device'].includes(fieldSource(s, field)) && (
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
          {activityNames[s.activity]}
          {s.activity === 'gym'
            ? ` · тренировка ${draft.workout!.position} из ${draft.workout!.totalWorkouts}`
            : ''}
        </p>
        {s.activity === 'gym' && draft.workout?.notes && (
          <p className={css.small}>{draft.workout.notes}</p>
        )}
        <label className={css.field}>
          <span>Дата занятия</span>
          <input type="date" value={s.date} onChange={(e) => patch({ date: e.target.value })} />
        </label>
        <div className={css.field}>
          <span>Самочувствие перед занятием · 0–5</span>
          <div className={css.scale} role="group" aria-label="Самочувствие">
            {Array.from({ length: 6 }, (_, i) => (
              <button
                key={i}
                className={s.wellbeing === i ? css.selected : ''}
                aria-pressed={s.wellbeing === i}
                onClick={() => patch({ wellbeing: i })}
              >
                {i}
              </button>
            ))}
          </div>
        </div>
        <NumberField
          label="Сон, часов"
          value={s.sleep}
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
        {activityNames[s.activity]} · {s.date}
        <br />
        Запиши время и ощущения.
      </p>
      {s.activity === 'gym' ? (
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
                value={s[key] ?? ''}
                onChange={(e) =>
                  patch({ [key]: e.target.value === '' ? null : Number(e.target.value) })
                }
              />
            </label>
          ))}
          {(['warmup', 'main', 'cardio'] as const).some(
            (key) => !['user_confirmed', 'device'].includes(fieldSource(s, key)),
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
            Разминка: {sourceNames[fieldSource(s, 'warmup')]}. Основная часть:{' '}
            {sourceNames[fieldSource(s, 'main')]}. Кардио: {sourceNames[fieldSource(s, 'cardio')]}.
          </p>
          <div className={css.total}>
            <span>Всего</span>
            <strong>{duration(s)} мин</strong>
          </div>
        </section>
      ) : (
        <NumberField
          label="Продолжительность, мин"
          value={s.durationMinutes}
          min={1}
          max={1440}
          onChange={(durationMinutes) => patch({ durationMinutes })}
        />
      )}
      {s.activity !== 'gym' && source('durationMinutes', 'продолжительность')}
      <section className={css.section}>
        <h2>Измеренный пульс · необязательно</h2>
        <div className={css.two}>
          <NumberField
            label="Минимальный пульс"
            value={s.pulseMin}
            min={1}
            max={400}
            onChange={(n) => patch({ pulseMin: n })}
          />
          <NumberField
            label="Максимальный пульс"
            value={s.pulseMax}
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
            value={s.pulseDevice ?? ''}
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
          value={s.exertion < 0 ? '' : s.exertion}
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
          value={s.notes}
          onChange={(e) => patch({ notes: e.target.value })}
          placeholder="Что хочется запомнить?"
        />
      </label>
    </>
  );
}
