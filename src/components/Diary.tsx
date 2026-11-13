'use client';
import { useEffect, useRef, useState } from 'react';
import {
  activityNames,
  newDraft,
  sessionSchema,
  validateSets,
  type Activity,
  type Bootstrap,
  type Draft,
  type SessionRecord,
} from '@/lib/domain';
import { today, dateLabel } from '@/lib/calendar';
import { loadDiary, saveSessionDraft } from '@/lib/session-api';
import { HistoryEntry, SessionHistory, SessionDetails, SessionSaved } from './SessionHistory';
import { NextActivity } from './NextActivity';
import { readDrafts, removeDraft, saveDraft } from '@/lib/drafts';
import { ActivityIcon } from './Fields';
import { ExerciseEditor } from './ExerciseEditor';
import { SessionForm } from './SessionForm';
import css from './Diary.module.css';
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
      setData(await loadDiary());
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
      const saved = await saveSessionDraft(draft);
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
  const openRecord = (record: SessionRecord) => {
    setRecord(record);
    navigate('detail');
  };
  const back = (
    <button className={css.back} onClick={() => navigate('home')}>
      <span>‹</span>Сегодня
    </button>
  );
  const goBackInSession = () => {
    if (!draft) return;
    if (draft.stage === 'prepare') {
      navigate('home');
      return;
    }
    const returnToWorkout = draft.stage === 'finish' && draft.input.activity === 'gym';
    change({ ...draft, stage: returnToWorkout ? 'workout' : 'prepare' });
  };
  let emptyHistoryMessage = 'Здесь появится твоё первое занятие.';
  if (loading) emptyHistoryMessage = 'Загружаю дневник…';
  else if (loadError) emptyHistoryMessage = 'История сейчас недоступна.';
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
            <NextActivity activity={activity} workout={data.workout} loading={loading} />
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
                <HistoryEntry record={data.history[0]} onOpen={openRecord} />
              ) : (
                <p className={css.small}>{emptyHistoryMessage}</p>
              )}
            </section>
          </>
        )}
        {view === 'session' && draft && (
          <>
            <button className={css.back} disabled={busy} onClick={goBackInSession}>
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
            <SessionHistory
              history={data.history}
              filter={filter}
              setFilter={setFilter}
              onOpen={openRecord}
              loadError={loadError}
            />
          </>
        )}
        {view === 'detail' && record && (
          <>
            <button className={css.back} onClick={() => navigate('history')}>
              <span>‹</span>История
            </button>
            <SessionDetails record={record} />
          </>
        )}
        {view === 'success' && record && (
          <>
            <SessionSaved record={record} nextWorkout={data.workout} />
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
              {sessionActionLabel(draft, busy)}
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

function sessionActionLabel(draft: Draft, busy: boolean) {
  if (busy) return 'Сохраняю…';
  if (draft.stage === 'prepare') return 'Начать занятие →';
  if (draft.stage === 'workout') return 'Перейти к итогам →';
  if (draft.editingRevision !== null) return 'Сохранить исправления';
  return 'Завершить и сохранить';
}
