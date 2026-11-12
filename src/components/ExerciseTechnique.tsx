'use client';

import Image from 'next/image';
import { useEffect, useId, useRef, useState } from 'react';
import { exerciseImages } from '@/lib/exercise-images';
import css from './ExerciseTechnique.module.css';

export function ExerciseTechnique({ exerciseId, name }: { exerciseId: string; name: string }) {
  const image = exerciseImages[exerciseId];
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open) return;
    dialog.current?.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = overflow;
    };
  }, [open]);

  if (!image || failed) return null;

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={css.preview}
        aria-label={`Открыть технику: ${name}`}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <Image
          src={image.src}
          alt={image.alt}
          width={1536}
          height={1024}
          sizes="(max-width: 440px) calc(100vw - 58px), 382px"
          onError={() => {
            dialog.current?.close();
            setOpen(false);
            setFailed(true);
          }}
        />
        <span>Смотреть крупнее ↗</span>
      </button>
      <dialog
        ref={dialog}
        className={css.viewer}
        aria-labelledby={titleId}
        onClose={() => {
          setOpen(false);
          setZoomed(false);
          trigger.current?.focus({ preventScroll: true });
        }}
      >
        <div className={css.header}>
          <h2 id={titleId}>{name}</h2>
          <button
            type="button"
            className={css.close}
            aria-label="Закрыть изображение"
            onClick={() => dialog.current?.close()}
            autoFocus
          >
            ✕
          </button>
        </div>
        {open && (
          <div className={css.viewport}>
            <Image
              src={image.src}
              alt={image.alt}
              width={1536}
              height={1024}
              unoptimized
              className={zoomed ? css.zoomed : css.fitted}
            />
          </div>
        )}
        <div className={css.toolbar}>
          <button type="button" aria-pressed={zoomed} onClick={() => setZoomed(!zoomed)}>
            {zoomed ? 'Уместить целиком' : 'Увеличить ×2'}
          </button>
          {zoomed && <p>Листай картинку, чтобы рассмотреть детали</p>}
        </div>
      </dialog>
    </>
  );
}
