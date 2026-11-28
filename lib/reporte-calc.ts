// Cálculos compartidos del reporte de horas (servidor y navegador). Sin dependencias.
export type SesionReporte = {
  asistencia_id: string;
  clase_id: string;
  fecha: string; // YYYY-MM-DD
  materia: string;
  grupo: string;
  plantel: string;
  dia_semana: number; // 1=lunes ... 7=domingo
  hora_inicio: string; // HH:MM[:SS]
  hora_fin: string;
  minutos: number;
};

export type FilaClase = {
  clase_id: string;
  grupo: string;
  materia: string;
  plantel: string;
  porDia: Record<number, number>; // minutos por día de la semana (suma)
  nDia: Record<number, number>; // sesiones por día de la semana
  horarios: string[]; // 'HH:MM-HH:MM' distintos
  minutos: number;
  monto: number;
  fechas: string[];
};

/** Importe en pesos de unos minutos a una tarifa por hora, redondeado a centavos */
export const montoMinutos = (minutos: number, tarifa: number) =>
  Math.round((minutos * Math.round(tarifa * 100)) / 60) / 100;

export function agruparPorClase(ses: SesionReporte[], tarifa: number): FilaClase[] {
  const m = new Map<string, FilaClase>();
  for (const s of [...ses].sort((a, b) => a.fecha.localeCompare(b.fecha))) {
    let f = m.get(s.clase_id);
    if (!f) {
      f = { clase_id: s.clase_id, grupo: s.grupo, materia: s.materia, plantel: s.plantel, porDia: {}, nDia: {}, horarios: [], minutos: 0, monto: 0, fechas: [] };
      m.set(s.clase_id, f);
    }
    f.porDia[s.dia_semana] = (f.porDia[s.dia_semana] || 0) + s.minutos;
    f.nDia[s.dia_semana] = (f.nDia[s.dia_semana] || 0) + 1;
    const hr = `${s.hora_inicio.slice(0, 5)}-${s.hora_fin.slice(0, 5)}`;
    if (!f.horarios.includes(hr)) f.horarios.push(hr);
    f.minutos += s.minutos;
    f.fechas.push(s.fecha);
  }
  const filas = [...m.values()].sort((a, b) => a.grupo.localeCompare(b.grupo) || a.materia.localeCompare(b.materia));
  for (const f of filas) f.monto = montoMinutos(f.minutos, tarifa);
  return filas;
}

export const totalMonto = (filas: FilaClase[]) =>
  Math.round(filas.reduce((a, f) => a + Math.round(f.monto * 100), 0)) / 100;

/** Horas con 1 decimal si es exacto a décimas (2.0), si no con 2 (1.75) */
export const fmtHoras = (min: number) => {
  const h = min / 60;
  return Math.abs(h * 10 - Math.round(h * 10)) < 1e-9 ? h.toFixed(1) : h.toFixed(2);
};
