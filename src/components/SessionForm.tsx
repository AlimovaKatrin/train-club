'use client';
import { activityNames, duration, type Draft, type SessionInput } from '@/lib/domain';
import { NumberField } from './Fields';
import css from './Diary.module.css';
export function SessionForm({ draft, change }: { draft: Draft; change: (next: Draft) => void }) {
  const s = draft.input;
  const patch = (value: Partial<SessionInput>) => change({ ...draft, input: { ...s, ...value } });
  if (draft.stage === 'prepare')
    return (
      <>
        <h1>Перед занятием</h1>
        <p className={css.subtitle}>
          {activityNames[s.activity]}
          {s.activity === 'gym' ? ` · тренировка ${draft.workout!.position} из 8` : ' · 1 час'}
        </p>
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
          onChange={(sleep) => patch({ sleep: sleep ?? NaN })}
        />
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
          <div className={css.total}>
            <span>Всего</span>
            <strong>{duration(s)} мин</strong>
          </div>
        </section>
      ) : (
        <div className={css.next}>
          <h2>1 час</h2>
          <p>Продолжительность учтена автоматически.</p>
        </div>
      )}
      <section className={css.section}>
        <h2>Пульс с часов, уд/мин</h2>
        <div className={css.two}>
          <NumberField
            label="Минимальный пульс"
            value={s.pulseMin}
            min={1}
            max={400}
            onChange={(n) => patch({ pulseMin: n ?? NaN })}
          />
          <NumberField
            label="Максимальный пульс"
            value={s.pulseMax}
            min={1}
            max={400}
            onChange={(n) => patch({ pulseMax: n ?? NaN })}
          />
        </div>
        <p className={css.small}>100–180 — предзаполнение. Замени его измерениями с часов.</p>
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
