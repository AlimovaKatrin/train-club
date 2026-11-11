'use client';
import { useEffect, useState } from 'react';
import { calendarDate, shiftDate } from '@/lib/training-export';
import css from './Diary.module.css';
export function ExportForm() {
  const [range, setRange] = useState('12weeks');
  const [timeZone, setTimeZone] = useState('Europe/Istanbul');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  useEffect(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const today = calendarDate(new Date(), zone);
    setTimeZone(zone);
    setFrom(shiftDate(today, -83));
    setTo(today);
  }, []);
  const download = async () => {
    setBusy(true);
    setError('');
    setStatus('');
    try {
      const params = new URLSearchParams({ range, timeZone });
      if (range === 'custom') {
        params.set('from', from);
        params.set('to', to);
      }
      const response = await fetch(`${location.pathname.replace(/\/$/, '')}/download?${params}`, {
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error ?? 'Не удалось выгрузить историю. Проверь ссылку и повтори.');
      }
      const blob = await response.blob();
      const filename =
        response.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1] ??
        'train-club-export.json';
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      setStatus('JSON-файл подготовлен. Его можно прикрепить к разбору тренировок.');
    } catch (e) {
      setError(
        e instanceof TypeError ? 'Нет связи с сервером. Попробуй ещё раз.' : (e as Error).message,
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={css.app}>
      <main className={css.main}>
        <h1>Экспорт для разбора</h1>
        <p className={css.subtitle}>
          Один JSON-файл: краткая сводка и все сохранённые занятия с упражнениями, планами и
          подходами.
        </p>
        <label className={css.field}>
          <span>Период выгрузки</span>
          <select value={range} onChange={(e) => setRange(e.target.value)} disabled={busy}>
            <option value="12weeks">Последние 12 недель</option>
            <option value="all">Вся история</option>
            <option value="custom">Выбрать даты</option>
          </select>
        </label>
        {range === 'custom' && (
          <div className={css.two}>
            <label className={css.field}>
              <span>С даты</span>
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                disabled={busy}
              />
            </label>
            <label className={css.field}>
              <span>По дату</span>
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                disabled={busy}
              />
            </label>
          </div>
        )}
        <label className={css.field}>
          <span>Часовой пояс выгрузки</span>
          <input value={timeZone} onChange={(e) => setTimeZone(e.target.value)} disabled={busy} />
        </label>
        <p className={css.small}>
          12 недель — 84 дня включая сегодня. Начальная и конечная даты входят в период. Черновики
          не выгружаются.
        </p>
        <div className={css.section}>
          <button
            className={css.primary}
            disabled={busy || !from || !to}
            onClick={() => void download()}
          >
            {busy ? 'Готовлю файл…' : 'Экспорт для разбора'}
          </button>
        </div>
        {error && (
          <p className={css.error} role="alert">
            {error}
          </p>
        )}
        {status && (
          <p className={css.status} role="status">
            {status}
          </p>
        )}
        <p className={css.notice}>
          Значения по умолчанию и старые записи без подтверждения помечаются отдельно.
          Неподтверждённый пульс не считается измерением.
        </p>
        <p className={css.small}>
          Доступ к этой странице даёт сама ссылка. Сохрани её у себя и не публикуй.
        </p>
      </main>
    </div>
  );
}
