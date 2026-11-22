'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { downloadCSV } from '@/lib/csv';
import { fmtDate, hhmm, hours, money, monthStartISO, todayISO } from '@/lib/format';
import type { Falta, ReporteHoras } from '@/lib/types';

export default function ReportesPage() {
  const [desde, setDesde] = useState(monthStartISO());
  const [hasta, setHasta] = useState(todayISO());
  const [tab, setTab] = useState<'horas' | 'faltas'>('horas');
  const [horas, setHoras] = useState<ReporteHoras[]>([]);
  const [faltas, setFaltas] = useState<Falta[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const [h, f] = await Promise.all([
      supabase.rpc('reporte_horas', { p_desde: desde, p_hasta: hasta }),
      supabase.rpc('reporte_faltas', { p_desde: desde, p_hasta: hasta }),
    ]);
    if (h.error || f.error) setError((h.error || f.error)!.message);
    setHoras(((h.data as ReporteHoras[]) || []).map((x) => ({
      ...x,
      hourly_rate: Number(x.hourly_rate),
      clases_impartidas: Number(x.clases_impartidas),
      retardos: Number(x.retardos),
      sin_salida: Number(x.sin_salida),
      minutos_pagables: Number(x.minutos_pagables),
    })));
    setFaltas((f.data as Falta[]) || []);
    setLoading(false);
  }, [desde, hasta]);

  useEffect(() => {
    load();
  }, [load]);

  const faltasPorProfe = useMemo(() => {
    const m: Record<string, number> = {};
    faltas.forEach((f) => (m[f.profesor_id] = (m[f.profesor_id] || 0) + 1));
    return m;
  }, [faltas]);

  const totalMin = horas.reduce((s, r) => s + r.minutos_pagables, 0);
  const totalMonto = horas.reduce((s, r) => s + (r.minutos_pagables / 60) * r.hourly_rate, 0);

  function exportar() {
    if (tab === 'horas') {
      downloadCSV(`horas_${desde}_a_${hasta}.csv`, [
        ['Profesor', 'Clases impartidas', 'Horas a pagar', 'Pago por hora', 'Monto', 'Retardos', 'Sin salida', 'Faltas'],
        ...horas.map((r) => [
          r.profesor_nombre, r.clases_impartidas, hours(r.minutos_pagables), r.hourly_rate,
          ((r.minutos_pagables / 60) * r.hourly_rate).toFixed(2), r.retardos, r.sin_salida,
          faltasPorProfe[r.profesor_id] || 0,
        ]),
      ]);
    } else {
      downloadCSV(`faltas_${desde}_a_${hasta}.csv`, [
        ['Fecha', 'Profesor', 'Materia', 'Grupo', 'Plantel', 'Horario'],
        ...faltas.map((f) => [f.fecha, f.profesor_nombre, f.materia, f.grupo, f.plantel, `${hhmm(f.hora_inicio)}-${hhmm(f.hora_fin)}`]),
      ]);
    }
  }

  return (
    <>
      <h1>Reportes de horas</h1>
      <p className="sub">Horas impartidas para pago y clases sin registro (faltas) por periodo.</p>

      {error && <div className="msg err">{error}</div>}

      <div className="card">
        <div className="form-grid">
          <div><label>Desde</label><input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></div>
          <div><label>Hasta</label><input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></div>
          <button className="btn ghost" onClick={exportar} disabled={loading}>Exportar CSV (Excel)</button>
        </div>
      </div>

      <div className="tabs">
        <button className={`tab ${tab === 'horas' ? 'active' : ''}`} onClick={() => setTab('horas')}>Horas por profesor</button>
        <button className={`tab ${tab === 'faltas' ? 'active' : ''}`} onClick={() => setTab('faltas')}>
          Faltas ({faltas.length})
        </button>
      </div>

      {tab === 'horas' && (
        <div className="card">
          <div className="table-wrap">
            <table className="stack">
              <thead>
                <tr>
                  <th>Profesor</th>
                  <th className="num">Clases</th>
                  <th className="num">Horas a pagar</th>
                  <th className="num">$ / hora</th>
                  <th className="num">Monto</th>
                  <th className="num">Retardos</th>
                  <th className="num">Sin salida</th>
                  <th className="num">Faltas</th>
                </tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={8} className="empty">Calculando…</td></tr>}
                {!loading && horas.length === 0 && <tr><td colSpan={8} className="empty">Sin registros en el periodo.</td></tr>}
                {!loading && horas.map((r) => (
                  <tr key={r.profesor_id}>
                    <td data-label="Profesor"><strong>{r.profesor_nombre}</strong></td>
                    <td data-label="Clases" className="num">{r.clases_impartidas}</td>
                    <td data-label="Horas a pagar" className="num"><strong>{hours(r.minutos_pagables)}</strong></td>
                    <td data-label="$ / hora" className="num">{money(r.hourly_rate)}</td>
                    <td data-label="Monto" className="num"><strong>{money((r.minutos_pagables / 60) * r.hourly_rate)}</strong></td>
                    <td data-label="Retardos" className="num">{r.retardos || '—'}</td>
                    <td data-label="Sin salida" className="num">{r.sin_salida ? <span className="badge warn">{r.sin_salida}</span> : '—'}</td>
                    <td data-label="Faltas" className="num">{faltasPorProfe[r.profesor_id] ? <span className="badge err">{faltasPorProfe[r.profesor_id]}</span> : '—'}</td>
                  </tr>
                ))}
              </tbody>
              {!loading && horas.length > 0 && (
                <tfoot>
                  <tr className="total">
                    <td data-label="Total"><strong>Total</strong></td>
                    <td className="skip-stack"></td>
                    <td data-label="Horas a pagar" className="num"><strong>{hours(totalMin)}</strong></td>
                    <td className="skip-stack"></td>
                    <td data-label="Monto" className="num"><strong>{money(totalMonto)}</strong></td>
                    <td className="skip-stack" colSpan={3}></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          <p className="sub" style={{ margin: '12px 0 0', fontSize: '0.85rem' }}>
            Las horas se calculan entre la entrada y la salida registradas, sin exceder la duración programada de la clase
            vigente cuando se registró. Una clase sin salida no suma horas hasta que se corrija.
          </p>
        </div>
      )}

      {tab === 'faltas' && (
        <div className="card">
          <div className="table-wrap">
            <table className="stack">
              <thead>
                <tr><th>Fecha</th><th>Profesor</th><th>Materia</th><th>Grupo</th><th>Plantel</th><th>Horario</th></tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={6} className="empty">Calculando…</td></tr>}
                {!loading && faltas.length === 0 && <tr><td colSpan={6} className="empty">Sin faltas en el periodo.</td></tr>}
                {!loading && faltas.map((f, i) => (
                  <tr key={i}>
                    <td data-label="Fecha">{fmtDate(f.fecha)}</td>
                    <td data-label="Profesor"><strong>{f.profesor_nombre}</strong></td>
                    <td data-label="Materia">{f.materia}</td>
                    <td data-label="Grupo">{f.grupo}</td>
                    <td data-label="Plantel">{f.plantel}</td>
                    <td data-label="Horario">{hhmm(f.hora_inicio)} – {hhmm(f.hora_fin)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="sub" style={{ margin: '12px 0 0', fontSize: '0.85rem' }}>
            Se considera falta una clase programada, ya concluida, sin ningún registro de entrada. El sistema aún no conoce
            días inhábiles ni suspensiones: revísalos antes de descontar.
          </p>
        </div>
      )}
    </>
  );
}
