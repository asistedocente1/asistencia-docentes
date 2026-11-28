'use client';

import { TOLERANCIA_MIN } from '@/lib/config';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { fmtTime, hhmm, isoWeekday, todayISO } from '@/lib/format';
import type { AsistenciaDetalle } from '@/lib/types';

export default function DashboardPage() {
  const [stats, setStats] = useState({ profes: 0, clasesHoy: 0, registros: 0, enCurso: 0, retardos: 0 });
  const [hoy, setHoy] = useState<AsistenciaDetalle[]>([]);

  useEffect(() => {
    (async () => {
      const head = { count: 'exact' as const, head: true };
      const [p, c, a] = await Promise.all([
        supabase.from('profiles').select('id', head).eq('role', 'profesor').eq('active', true),
        supabase.from('clases').select('id', head).eq('activo', true).eq('dia_semana', isoWeekday()),
        supabase.from('asistencias_detalle').select('*').eq('fecha', todayISO()).order('entrada', { ascending: false }),
      ]);
      const rows = (a.data as AsistenciaDetalle[]) || [];
      setHoy(rows);
      setStats({
        profes: p.count || 0,
        clasesHoy: c.count || 0,
        registros: rows.length,
        enCurso: rows.filter((r) => !r.salida).length,
        retardos: rows.filter((r) => r.retardo_min > TOLERANCIA_MIN).length,
      });
    })();
  }, []);

  const cards = [
    { n: stats.profes, l: 'Profesores activos' },
    { n: stats.clasesHoy, l: 'Clases programadas hoy' },
    { n: stats.registros, l: 'Entradas registradas hoy' },
    { n: stats.enCurso, l: 'Clases en curso' },
    { n: stats.retardos, l: 'Retardos hoy' },
  ];

  return (
    <>
      <h1>Dashboard</h1>
      <p className="sub">Resumen del día en tiempo real.</p>

      <div className="grid stats">
        {cards.map((c) => (
          <div className="stat" key={c.l}>
            <div className="n">{c.n}</div>
            <div className="l">{c.l}</div>
          </div>
        ))}
      </div>

      <div className="card">
        <h2>Registros de hoy</h2>
        <div className="table-wrap">
          <table className="stack">
            <thead>
              <tr>
                <th>Profesor</th><th>Materia</th><th>Horario</th><th>Entrada</th><th>Salida</th><th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {hoy.length === 0 && <tr><td colSpan={6} className="empty">Todavía no hay registros hoy.</td></tr>}
              {hoy.map((r) => (
                <tr key={r.id}>
                  <td data-label="Profesor"><strong>{r.profesor_nombre}</strong></td>
                  <td data-label="Materia">{r.materia}</td>
                  <td data-label="Horario">{hhmm(r.hora_inicio)} – {hhmm(r.hora_fin)}</td>
                  <td data-label="Entrada">{fmtTime(r.entrada)}</td>
                  <td data-label="Salida">{fmtTime(r.salida)}</td>
                  <td data-label="Estado">
                    {!r.salida ? <span className="badge warn">En curso</span> : <span className="badge ok">Completada</span>}{' '}
                    {r.retardo_min > 0 && <span className="badge err">Retardo {r.retardo_min} min</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
