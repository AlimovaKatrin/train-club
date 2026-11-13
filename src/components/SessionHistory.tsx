import {
  activityNames,
  duration,
  formatSet,
  weightNames,
  type Activity,
  type SessionRecord,
  type Workout,
} from '@/lib/domain';
import { dateLabel } from '@/lib/calendar';
import css from './Diary.module.css';

export function HistoryEntry({
  record,
  onOpen,
}: {
  record: SessionRecord;
  onOpen: (record: SessionRecord) => void;
}) {
  return (
    <button className={css.row} onClick={() => onOpen(record)}>
      <span>
        <strong>
          {activityNames[record.input.activity]}
          {record.workout ? ` · тренировка ${record.workout.position}` : ''}
        </strong>
        <small>
          {dateLabel(record.input.date)} · {duration(record.input)} мин · тяжесть{' '}
          {record.input.exertion}/10
        </small>
      </span>
      <span>›</span>
    </button>
  );
}

export function SessionHistory({
  history,
  filter,
  setFilter,
  onOpen,
  loadError,
}: {
  history: SessionRecord[];
  filter: Activity | 'all';
  setFilter: (filter: Activity | 'all') => void;
  onOpen: (record: SessionRecord) => void;
  loadError: string;
}) {
  const filteredHistory = history.filter(
    (record) => filter === 'all' || record.input.activity === filter,
  );
  return (
    <>
      <h1>
        Каждое занятие
        <br />
        имеет значение.
      </h1>
      <div className={css.filters} role="group" aria-label="Фильтр истории">
        {(['all', 'gym', 'pilates', 'boxing'] as const).map((type) => (
          <button
            key={type}
            className={filter === type ? css.selected : ''}
            aria-pressed={filter === type}
            onClick={() => setFilter(type)}
          >
            {type === 'all' ? 'Все' : activityNames[type]}
          </button>
        ))}
      </div>
      {filteredHistory.map((record) => (
        <HistoryEntry key={record.input.id} record={record} onOpen={onOpen} />
      ))}
      {filteredHistory.length === 0 && (
        <p className={css.empty}>
          {loadError ? 'История сейчас недоступна.' : 'Пока нет занятий этого вида.'}
        </p>
      )}
      <p className={css.small}>Показаны последние 100 занятий.</p>
    </>
  );
}

export function SessionDetails({ record }: { record: SessionRecord }) {
  return (
    <>
      <h1>
        {activityNames[record.input.activity]}
        {record.workout ? ` · ${record.workout.position}` : ''}
      </h1>
      <p>{dateLabel(record.input.date)}</p>
      <div className={css.card}>
        {[
          ['Самочувствие до', `${record.input.wellbeing} / 5`],
          ['Сон', record.input.sleep === null ? 'Не указано' : `${record.input.sleep} ч`],
          ['Продолжительность', `${duration(record.input)} мин`],
          ...(record.input.activity === 'gym'
            ? [
                [
                  'Разминка / основная / кардио',
                  `${record.input.warmup} / ${record.input.main} / ${record.input.cardio} мин`,
                ],
              ]
            : []),
          [
            'Пульс',
            record.input.pulseMin === null && record.input.pulseMax === null
              ? 'Не измерен'
              : `${record.input.pulseMin ?? '—'}–${record.input.pulseMax ?? '—'} уд/мин`,
          ],
          ['Тяжесть', `${record.input.exertion} / 10`],
        ].map(([label, value]) => (
          <div className={css.row} key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      {record.input.exercises.map((e) => {
        const o = record.workout!.options.find((o) => o.id === e.optionId)!;
        return (
          <section key={e.optionId} className={css.section}>
            <h2>{o.name}</h2>
            <p className={css.small}>
              {weightNames[o.weightType]}
              {o.perSide ? ' · на каждую сторону' : ''}
            </p>
            {e.sets.map((s) => (
              <div key={`${s.type}-${s.position}`} className={css.row}>
                <span>{s.type === 'warmup' ? 'Разминка' : `${s.position} · рабочий`}</span>
                <strong>{formatSet(s)}</strong>
              </div>
            ))}
          </section>
        );
      })}
      {record.input.notes && (
        <section className={css.section}>
          <h2>Заметка</h2>
          <p style={{ whiteSpace: 'pre-wrap' }}>{record.input.notes}</p>
        </section>
      )}
    </>
  );
}

export function SessionSaved({
  record,
  nextWorkout,
}: {
  record: SessionRecord;
  nextWorkout: Workout | null;
}) {
  return (
    <>
      <div className={css.success}>
        <div className={css.seal}>✓</div>
        <h1>
          Ещё одна
          <br />в твою пользу.
        </h1>
        <p>Занятие сохранено в дневнике.</p>
      </div>
      <div className={css.card}>
        <h2>{activityNames[record.input.activity]}</h2>
        <p className={css.subtitle}>{dateLabel(record.input.date)}</p>
        <div className={css.row}>
          <span>Всего времени</span>
          <strong>{duration(record.input)} мин</strong>
        </div>
        <div className={css.row}>
          <span>Тяжесть</span>
          <strong>{record.input.exertion} / 10</strong>
        </div>
      </div>
      {nextWorkout && (
        <p className={css.subtitle}>
          Следующая в зале — тренировка {nextWorkout.position} из {nextWorkout.totalWorkouts}.
        </p>
      )}
    </>
  );
}
