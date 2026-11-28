import { TZ } from './config';

/** Fecha de hoy (YYYY-MM-DD) en hora de Ciudad de México */
export const todayISO = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });

/** Día de la semana ISO de hoy: 1=lunes ... 7=domingo */
export const isoWeekday = () => {
  const [y, m, d] = todayISO().split('-').map(Number);
  const w = new Date(y, m - 1, d).getDay();
  return w === 0 ? 7 : w;
};

export const addDays = (iso: string, n: number) => {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  return dt.toLocaleDateString('en-CA');
};

export const monthStartISO = () => todayISO().slice(0, 8) + '01';

export const fmtTime = (ts?: string | null) =>
  ts
    ? new Date(ts).toLocaleTimeString('es-MX', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false })
    : '—';

export const fmtDateTime = (ts: string) =>
  new Date(ts).toLocaleString('es-MX', {
    timeZone: TZ,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

export const fmtDate = (d: string) =>
  new Date(d + 'T12:00:00').toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });

export const hhmm = (t: string) => t.slice(0, 5);

/** 'HH:MM' o 'HH:MM:SS' -> minutos desde medianoche */
export const toMin = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};

export const hours = (min?: number | null) => (min == null ? '—' : (min / 60).toFixed(2));

export const money = (n: number) => n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
