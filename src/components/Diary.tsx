'use client';
import { useEffect, useRef, useState } from 'react';
import {
  activityNames,
  duration,
  formatSet,
  newDraft,
  sessionSchema,
  validateSets,
  weightNames,
  type Activity,
  type Bootstrap,
  type Draft,
  type SessionRecord,
} from '@/lib/domain';
import { readDrafts, removeDraft, saveDraft } from '@/lib/drafts';
import { ActivityIcon } from './Fields';
import { ExerciseEditor } from './ExerciseEditor';
import { SessionForm } from './SessionForm';
import css from './Diary.module.css';
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const dateLabel = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  const body = await response.json();
  if (!response.ok)
    throw new Error(body.error ?? 'Не удалось сохранить занятие. Черновик остаётся на устройстве.');
  return body;
}
export function Diary() {
  const [data, setData] = useState<Bootstrap>({ workout: null, history: [] });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [view, setView] = useState<'home' | 'session' | 'history' | 'detail' | 'success'>('home');
  const [activity, setActivity] = useState<Activity>('gym');
  const [date, setDate] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [savedDrafts, setSavedDrafts] = useState<Draft[]>([]);
  const [draftsReady, setDraftsReady] = useState(false);
  const [localStatus, setLocalStatus] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<Activity | 'all'>('all');
  const [record, setRecord] = useState<SessionRecord | null>(null);
  const writes = useRef<Promise<void>>(Promise.resolve());
  const latestId = useRef<string | null>(null);
  const writeVersion = useRef(0);
  const refresh = async () => {
    try {
      setData(await api<Bootstrap>('/api/bootstrap'));
      setLoadError('');
    } catch (e) {
      setLoadError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    setDate(today());
    void refresh();
    void readDrafts()
      .then(setSavedDrafts)
      .catch(() => setLocalStatus('Не удалось прочитать черновики на устройстве.'))
      .finally(() => setDraftsReady(true));
  }, []);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [view, draft?.stage, draft?.exerciseIndex]);
  const change = (next: Draft) => {
    setDraft(next);
    setError('');
    latestId.current = next.input.id;
    setLocalStatus('Сохраняю на устройстве…');
    const version = ++writeVersion.current;
    setSavedDrafts((rows) => [next, ...rows.filter((d) => d.input.id !== next.input.id)]);
    // Enqueue at the input event, not on page close; preserve ordering through submit and delete.
    writes.current = writes.current
      .catch(() => {})
      .then(async () => {
        await saveDraft(next);
        if (latestId.current === next.input.id && version === writeVersion.current)
          setLocalStatus('Черновик сохранён на устройстве');
      })
      .catch(() => {
        setLocalStatus('Не удалось сохранить изменения на устройстве. Не закрывай эту вкладку.');
      });
  };
  const navigate = (to: typeof view) => {
    setError('');
    setView(to);
  };
  const start = () => {
    if (!date) {
      setError('Выбери дату занятия.');
      return;
    }
    if (activity === 'gym' && !data.workout) {
      setError('Сначала нужно загрузить согласованную программу.');
      return;
    }
    change(newDraft(activity, date, data.workout));
    navigate('session');
  };
  const advance = () => {
    if (!draft) return;
    const s = draft.input;
    if (draft.stage === 'prepare') {
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(s.date) ||
        s.wellbeing < 0 ||
        s.wellbeing > 5 ||
        (s.sleep !== null && (!Number.isFinite(s.sleep) || s.sleep < 0 || s.sleep > 24))
      ) {
        setError('Укажи дату, самочувствие и сон от 0 до 24 часов.');
        return;
      }
      change({ ...draft, stage: s.activity === 'gym' ? 'workout' : 'finish' });
    } else if (draft.stage === 'workout') {
      try {
        s.exercises.forEach((e) =>
          validateSets(
            e.sets,
            draft.workout!.options.find((o) => o.id === e.optionId)!,
          ),
        );
        change({ ...draft, stage: 'finish' });
      } catch (e) {
        setError((e as Error).message);
      }
    }
  };
  const submit = async () => {
    if (!draft || busy) return;
    const checked = sessionSchema.safeParse(draft.input);
    if (!checked.success) {
      setError(
        checked.error.issues.find((i) => i.code === 'custom')?.message ??
          'Проверь дату, сон, пульс и тяжесть занятия.',
      );
      return;
    }
    setBusy(true);
    setError('');
    try {
      await writes.current;
      const saved = await api<SessionRecord>(
        draft.editingRevision === null ? '/api/sessions' : `/api/sessions/${draft.input.id}`,
        {
          method: draft.editingRevision === null ? 'POST' : 'PATCH',
          body: JSON.stringify(
            draft.editingRevision === null
              ? draft.input
              : { input: draft.input, revision: draft.editingRevision },
          ),
        },
      );
      latestId.current = null;
      try {
        await removeDraft(draft.input.id);
        setSavedDrafts((rows) => rows.filter((d) => d.input.id !== draft.input.id));
        setLocalStatus('');
      } catch {
        setLocalStatus(
          'Занятие сохранено на сервере, но локальный черновик не удалось удалить. Повторная отправка не создаст дубликат.',
        );
      }
      setRecord(saved);
      setDraft(null);
      setView('success');
      await refresh();
    } catch (e) {
      setError(
        e instanceof TypeError
          ? 'Нет связи с сервером. Черновик остаётся на устройстве; повтори отправку после восстановления сети.'
          : (e as Error).message,
      );
    } finally {
      setBusy(false);
    }
  };
  const edit = () => {
    if (!record) return;
    const existing = savedDrafts.find((d) => d.input.id === record.input.id);
    change(
      existing ?? {
        version: 1,
        input: structuredClone(record.input),
        workout: record.workout,
        stage: 'prepare',
        exerciseIndex: 0,
        setIndex: 0,
        editingRevision: record.revision,
      },
    );
    navigate('session');
  };
  const entry = (r: SessionRecord) => (
    <button
      key={r.input.id}
      className={css.row}
      onClick={() => {
        setRecord(r);
        navigate('detail');
      }}
    >
      <span>
        <strong>
          {activityNames[r.input.activity]}
          {r.workout ? ` · тренировка ${r.workout.position}` : ''}
        </strong>
        <small>
          {dateLabel(r.input.date)} · {duration(r.input)} мин · тяжесть {r.input.exertion}/10
        </small>
      </span>
      <span>›</span>
    </button>
  );
  const back = (
    <button className={css.back} onClick={() => navigate('home')}>
      <span>‹</span>Сегодня
    </button>
  );
  const isWorkout = view === 'session' && draft?.stage === 'workout';
  return (
    <div className={`${css.app} ${isWorkout ? css.workoutScreen : ''}`}>
      {process.env.NEXT_PUBLIC_DEMO_MODE === 'true' && (
        <div className={css.demo}>Демо: тестовая программа и отдельная база</div>
      )}
      <header className={css.header}>
        <div className={css.brand}>
          <ActivityIcon type="gym" />
          train club
        </div>
        <span className={css.edition}>Личный дневник</span>
      </header>
      <main className={css.main}>
        {loadError && (
          <div className={css.notice} role="status">
            {loadError}
            <br />
            <button className={css.textButton} onClick={() => void refresh()}>
              Повторить загрузку
            </button>
          </div>
        )}
        {view === 'home' && (
          <>
            <label className={css.field}>
              <span className={css.small}>Дата занятия</span>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <h2>Чем займёмся сегодня?</h2>
            <div className={css.kinds} role="group" aria-label="Вид занятия">
              {(Object.keys(activityNames) as Activity[]).map((type) => (
                <button
                  key={type}
                  className={`${css.kind} ${activity === type ? css.selected : ''}`}
                  aria-pressed={activity === type}
                  onClick={() => setActivity(type)}
                >
                  <ActivityIcon type={type} />
                  {activityNames[type]}
                </button>
              ))}
            </div>
            {activity === 'gym' ? (
              <div className={css.next}>
                <span className={css.small}>Следующая по плану</span>
                {loading ? (
                  <h2>Загружаю план…</h2>
                ) : data.workout ? (
                  <>
                    <h2>Тренировка {String(data.workout.position).padStart(2, '0')}</h2>
                    <p>{data.workout.programName}</p>
                    <div
                      className={css.sequence}
                      aria-label={`Следующая тренировка ${data.workout.position} из ${data.workout.totalWorkouts}`}
                    >
                      {Array.from({ length: data.workout.totalWorkouts }, (_, i) => (
                        <span
                          key={i}
                          className={i + 1 === data.workout!.position ? css.current : ''}
                        >
                          {i + 1}
                        </span>
                      ))}
                    </div>
                    <p>
                      После №{data.workout.totalWorkouts} — снова №{data.workout.repeatFrom}. Без
                      спешки.
                    </p>
                  </>
                ) : (
                  <>
                    <h2>Программа пока не добавлена</h2>
                    <p>Здесь появятся тренировки и замены из твоей программы.</p>
                  </>
                )}
              </div>
            ) : (
              <div className={css.next}>
                <span className={css.small}>{activityNames[activity]}</span>
                <h2>Час для себя</h2>
                <p>После занятия запиши пульс и ощущения. Очередь зала останется прежней.</p>
              </div>
            )}
            {savedDrafts.length > 0 && (
              <section className={css.section}>
                <h2>Незавершённые занятия</h2>
                {savedDrafts.map((d) => (
                  <button
                    className={css.row}
                    key={d.input.id}
                    onClick={() => {
                      setDraft(d);
                      latestId.current = d.input.id;
                      setLocalStatus('Черновик восстановлен с устройства');
                      navigate('session');
                    }}
                  >
                    <span>
                      Продолжить: {activityNames[d.input.activity]}
                      <small>
                        {dateLabel(d.input.date)}
                        {d.editingRevision !== null ? ' · исправление истории' : ''}
                      </small>
                    </span>
                    <span>›</span>
                  </button>
                ))}
              </section>
            )}
            <section className={css.section}>
              <div className={css.sectionHead}>
                <h2>Последняя тренировка</h2>
                <button className={css.textButton} onClick={() => navigate('history')}>
                  Вся история
                </button>
              </div>
              {data.history[0] ? (
                entry(data.history[0])
              ) : (
                <p className={css.small}>
                  {loading
                    ? 'Загружаю дневник…'
                    : loadError
                      ? 'История сейчас недоступна.'
                      : 'Здесь появится твоё первое занятие.'}
                </p>
              )}
            </section>
          </>
        )}
        {view === 'session' && draft && (
          <>
            <button
              className={css.back}
              disabled={busy}
              onClick={() => {
                if (draft.stage === 'prepare') navigate('home');
                else
                  change({
                    ...draft,
                    stage:
                      draft.stage === 'workout'
                        ? 'prepare'
                        : draft.input.activity === 'gym'
                          ? 'workout'
                          : 'prepare',
                  });
              }}
            >
              <span>‹</span>
              {draft.editingRevision !== null
                ? 'Исправление записи'
                : activityNames[draft.input.activity]}
            </button>
            <fieldset disabled={busy} className={css.unstyledFieldset}>
              {draft.stage === 'workout' ? (
                <ExerciseEditor
                  draft={draft}
                  change={change}
                  onError={setError}
                  onFinish={advance}
                  status={localStatus}
                  error={error}
                />
              ) : (
                <SessionForm draft={draft} change={change} />
              )}
            </fieldset>
          </>
        )}
        {view === 'history' && (
          <>
            {back}
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
            {data.history.filter((r) => filter === 'all' || r.input.activity === filter).map(entry)}
            {!data.history.some((r) => filter === 'all' || r.input.activity === filter) && (
              <p className={css.empty}>
                {loadError ? 'История сейчас недоступна.' : 'Пока нет занятий этого вида.'}
              </p>
            )}
            <p className={css.small}>Показаны последние 100 занятий.</p>
          </>
        )}
        {view === 'detail' && record && (
          <>
            <button className={css.back} onClick={() => navigate('history')}>
              <span>‹</span>История
            </button>
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
        )}
        {view === 'success' && record && (
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
            {data.workout && (
              <p className={css.subtitle}>
                Следующая в зале — тренировка {data.workout.position} из{' '}
                {data.workout.totalWorkouts}.
              </p>
            )}
          </>
        )}
        {error && !isWorkout && (
          <div className={css.error} role="alert">
            {error}
          </div>
        )}
        {localStatus && !isWorkout && (
          <p className={css.status} role="status">
            {localStatus}
          </p>
        )}
      </main>
      {!isWorkout && (
        <footer className={css.actionbar}>
          {view === 'home' && (
            <button
              className={css.primary}
              disabled={!draftsReady || !date || (activity === 'gym' && (loading || !data.workout))}
              onClick={start}
            >
              Начать тренировку →
            </button>
          )}
          {view === 'session' && draft && (
            <button
              className={css.primary}
              disabled={busy}
              onClick={draft.stage === 'finish' ? () => void submit() : advance}
            >
              {busy
                ? 'Сохраняю…'
                : draft.stage === 'prepare'
                  ? 'Начать занятие →'
                  : draft.stage === 'workout'
                    ? 'Перейти к итогам →'
                    : draft.editingRevision !== null
                      ? 'Сохранить исправления'
                      : 'Завершить и сохранить'}
            </button>
          )}
          {view === 'detail' && (
            <button className={css.primary} onClick={edit}>
              Исправить запись
            </button>
          )}
          {view === 'success' && (
            <button className={css.primary} onClick={() => navigate('history')}>
              Открыть дневник →
            </button>
          )}
          {view === 'history' && (
            <button className={css.primary} onClick={() => navigate('home')}>
              Новое занятие →
            </button>
          )}
          <nav className={css.nav} aria-label="Основная навигация">
            <button
              disabled={busy}
              aria-current={view === 'home' ? 'page' : undefined}
              onClick={() => navigate('home')}
            >
              ⌂ Сегодня
            </button>
            <button
              disabled={busy}
              aria-current={view === 'history' ? 'page' : undefined}
              onClick={() => navigate('history')}
            >
              ◷ История
            </button>
          </nav>
        </footer>
      )}
    </div>
  );
}
