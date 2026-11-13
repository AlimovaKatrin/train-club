import { activityNames, type Activity, type Workout } from '@/lib/domain';
import css from './Diary.module.css';

export function NextActivity({
  activity,
  workout,
  loading,
}: {
  activity: Activity;
  workout: Workout | null;
  loading: boolean;
}) {
  if (activity !== 'gym') {
    return (
      <div className={css.next}>
        <span className={css.small}>{activityNames[activity]}</span>
        <h2>Час для себя</h2>
        <p>После занятия запиши пульс и ощущения. Очередь зала останется прежней.</p>
      </div>
    );
  }
  return (
    <div className={css.next}>
      <span className={css.small}>Следующая по плану</span>
      <NextWorkout workout={workout} loading={loading} />
    </div>
  );
}

function NextWorkout({ workout, loading }: { workout: Workout | null; loading: boolean }) {
  if (loading) return <h2>Загружаю план…</h2>;
  if (!workout)
    return (
      <>
        <h2>Программа пока не добавлена</h2>
        <p>Здесь появятся тренировки и замены из твоей программы.</p>
      </>
    );
  return (
    <>
      <h2>Тренировка {String(workout.position).padStart(2, '0')}</h2>
      <p>{workout.programName}</p>
      <div
        className={css.sequence}
        aria-label={`Следующая тренировка ${workout.position} из ${workout.totalWorkouts}`}
      >
        {Array.from({ length: workout.totalWorkouts }, (_, i) => (
          <span key={i} className={i + 1 === workout.position ? css.current : ''}>
            {i + 1}
          </span>
        ))}
      </div>
      <p>
        После №{workout.totalWorkouts} — снова №{workout.repeatFrom}. Без спешки.
      </p>
    </>
  );
}
