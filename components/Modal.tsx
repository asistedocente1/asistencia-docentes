'use client';

import { ReactNode, useEffect } from 'react';
import Icon from './Icon';

interface Props {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  /** Evita cerrar al tocar fuera (útil mientras se está registrando algo) */
  locked?: boolean;
}

/** Ventana emergente. En celular se muestra como hoja que sube desde abajo. */
export default function Modal({ title, subtitle, onClose, children, locked }: Props) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !locked) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose, locked]);

  return (
    <div className="modal-bg" onClick={() => !locked && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2>{title}</h2>
            {subtitle && <p className="sub" style={{ margin: 0 }}>{subtitle}</p>}
          </div>
          <button className="icon-btn" onClick={onClose} disabled={locked} aria-label="Cerrar">
            <Icon name="x" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
