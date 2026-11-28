'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { MODALIDAD_LABEL } from '@/lib/config';
import { addDays, fmtDate, fmtTime, hhmm, hours, todayISO } from '@/lib/format';
import type { AsistenciaDetalle, Profile } from '@/lib/types';
import Modal from '@/components/Modal';

export default function AsistenciasPage() {
  const [desde, setDesde] = useState(addDays(todayISO(), -7));
  const [hasta, setHasta] = useState(todayISO());
  const [profe, setProfe] = useState('');
  const [profes, setProfes] = useState<Profile[]>([]);
  const [rows, setRows] = useState<AsistenciaDetalle[]>([]);
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState<AsistenciaDetalle | null>(null);
  const [fotos, setFotos] = useState<{ entrada?: string; salida?: string }>({});

  useEffect(() => {
    supabase.from('profiles').select('*').eq('role', 'profesor').order('full_name')
      .then(({ data }) => setProfes((data as Profile[]) || []));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    let q = supabase.from('asistencias_detalle').select('*').gte('fecha', desde).lte('fecha', hasta)
      .order('fecha', { ascending: false }).order('entrada', { ascending: false }).limit(500);
    if (profe) q = q.eq('profesor_id', profe);
    const { data } = await q;
    setRows((data as AsistenciaDetalle[]) || []);
    setLoading(false);
  }, [desde, hasta, profe]);

  useEffect(() => {
    load();
  }, [load]);

  async function verFotos(r: AsistenciaDetalle) {
    setSel(r);
    setFotos({});
    const out: { entrada?: string; salida?: string } = {};
    if (r.foto_entrada) {
      const { data } = await supabase.storage.from('asistencia-fotos').createSignedUrl(r.foto_entrada, 300);
      out.entrada = data?.signedUrl;
    }
    if (r.foto_salida) {
      const { data } = await supabase.storage.from('asistencia-fotos').createSignedUrl(r.foto_salida, 300);
      out.salida = data?.signedUrl;
    }
    setFotos(out);
  }

  return (
    <>
      <h1>Asistencias</h1>
      <p className="sub">Consulta de entradas y salidas con su evidencia fotográfica.</p>

      <div className="card">
        <div className="form-grid">
          <div><label>Desde</label><input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></div>
          <div><label>Hasta</label><input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></div>
          <div>
            <label>Profesor</label>
            <select value={profe} onChange={(e) => setProfe(e.target.value)}>
              <option value="">Todos</option>
              {profes.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
            </select>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table className="stack">
            <thead>
              <tr>
                <th>Fecha</th><th>Profesor</th><th>Materia</th><th>Horario</th>
                <th>Entrada</th><th>Salida</th><th className="num">Horas</th><th></th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={8} className="empty">Cargando…</td></tr>}
              {!loading && rows.length === 0 && <tr><td colSpan={8} className="empty">Sin registros en el periodo.</td></tr>}
              {!loading && rows.map((r) => (
                <tr key={r.id}>
                  <td data-label="Fecha">{fmtDate(r.fecha)}</td>
                  <td data-label="Profesor"><strong>{r.profesor_nombre}</strong></td>
                  <td data-label="Materia">
                    {r.materia} <span className="meta">· {r.grupo}</span>
                    {r.modalidad === 'en_linea' && <> <span className="badge warn">En línea</span></>}
                  </td>
                  <td data-label="Horario">{hhmm(r.hora_inicio)} – {hhmm(r.hora_fin)}</td>
                  <td data-label="Entrada">
                    {fmtTime(r.entrada)} {r.retardo_min > 0 && <span className="badge err">+{r.retardo_min}m</span>}
                  </td>
                  <td data-label="Salida">{r.salida ? fmtTime(r.salida) : <span className="badge warn">Sin salida</span>}</td>
                  <td data-label="Horas" className="num">{hours(r.minutos_pagables)}</td>
                  <td className="actions">
                    {(r.foto_entrada || r.foto_salida) ? (
                      <button className="btn sm ghost" onClick={() => verFotos(r)}>Fotos</button>
                    ) : <span className="badge err">Sin foto</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length === 500 && <p className="sub" style={{ marginTop: 10 }}>Mostrando los primeros 500 registros; acota el rango de fechas.</p>}
      </div>

      {sel && (
        <Modal
          title={sel.profesor_nombre}
          subtitle={`${sel.materia} · ${fmtDate(sel.fecha)}${sel.modalidad ? ' · ' + MODALIDAD_LABEL[sel.modalidad] : ''}`}
          onClose={() => setSel(null)}
        >
          <div className="photos">
            <figure>
              {fotos.entrada ? <img src={fotos.entrada} alt="Foto de entrada" /> : <div className="empty">{sel.foto_entrada ? 'Cargando…' : 'Sin foto de entrada'}</div>}
              <figcaption>Entrada · {fmtTime(sel.entrada)}</figcaption>
            </figure>
            <figure>
              {fotos.salida ? <img src={fotos.salida} alt="Foto de salida" /> : <div className="empty">{sel.foto_salida ? 'Cargando…' : 'Sin foto de salida'}</div>}
              <figcaption>Salida · {fmtTime(sel.salida)}</figcaption>
            </figure>
          </div>
          <p className="meta" style={{ margin: 0 }}>
            Abierta por: <strong>{sel.abierta_por_nombre ?? '—'}</strong>
            {sel.salida && <> · Cerrada por: <strong>{sel.cerrada_por_nombre ?? '—'}</strong></>}
          </p>
        </Modal>
      )}
    </>
  );
}
