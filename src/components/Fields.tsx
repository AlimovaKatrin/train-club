'use client';
import { useId } from 'react';
import css from './Diary.module.css';
export function NumberField({
  label,
  value,
  onChange,
  step = 1,
  min = 0,
  max = 10000,
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  step?: number;
  min?: number;
  max?: number;
}) {
  const id = useId();
  const shown = value === null || !Number.isFinite(value) ? '' : value;
  const move = (direction: number) => {
    const currentValue = Number(shown) || 0;
    const steppedValue = currentValue + direction * step;
    const roundedValue = Math.round(steppedValue * 100) / 100;
    const boundedValue = Math.max(min, Math.min(max, roundedValue));
    onChange(boundedValue);
  };
  return (
    <div className={css.field}>
      <label htmlFor={id}>{label}</label>
      <div className={css.stepper}>
        <button type="button" aria-label={`Уменьшить: ${label}`} onClick={() => move(-1)}>
          −
        </button>
        <input
          id={id}
          type="number"
          inputMode={step < 1 ? 'decimal' : 'numeric'}
          step={step}
          min={min}
          max={max}
          value={shown}
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        />
        <button type="button" aria-label={`Увеличить: ${label}`} onClick={() => move(1)}>
          +
        </button>
      </div>
    </div>
  );
}
export function ActivityIcon({ type }: { type: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {type === 'gym' && <path d="M3 8v8m4-11v14m10-14v14m4-11v8M7 12h10" />}
      {type === 'pilates' && (
        <>
          <circle cx="15" cy="5" r="2" />
          <path d="m13 9-4 5 5 3m-5-3-5 4m8-8 5 3 4-3M3 22h18" />
        </>
      )}
      {type !== 'gym' && type !== 'pilates' && (
        <path d="M7 17H5l-2-6V7l3-3h11l4 4v6l-3 3v5H7v-7m0 2h11M7 8v5" />
      )}
    </svg>
  );
}
