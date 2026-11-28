'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { downloadCSV } from '@/lib/csv';
import { DIAS, TOLERANCIA_MIN } from '@/lib/config';
import { fmtDate, fmtDateTime, hhmm, hours, money, monthStartISO, todayISO } from '@/lib/format';
import Modal from '@/components/Modal';
import type { ClaseHoras, Falta, ReporteEmitido, ReporteHoras } from '@/lib/types';

const MAX_CLASES = 7;
type Prof = { id: string; full_name: string; hourly_rate: number };

const mesIni = (offset: number) => {
  const [y, m] = todayISO().split('-').map(Number);
  const d = new Date(y, m - 1 + offset, 1);
  return d.toLocaleDateString('en-CA');
};
const mesFin = (offset: number) => {
  const [y, m] = todayISO().split('-').map(Number);
  return new Date(y, m + offset, 0).toLocaleDateString('en-CA');
};

export default function ReportesPage() {
  const { session, profile } = useAuth();
  const puedeEmitir = profile?.role === 'super_admin' || profile?.role === 'admin';

  const [desde, setDesde] = useState(monthStartISO());
  const [hasta, setHasta] = useState(todayISO());
  const [tab, setTab] = useState<'horas' | 'faltas' | 'emitidos'>('horas');
  const [horas, setHoras] = useState<ReporteHoras[]>([]);
  const [faltas, setFaltas] = useState<Falta[]>([]);
  const [clases, setClases] = useState<ClaseHoras[]>([]);
  const [profs, setProfs] = useState<Prof[]>([]);
  const [emitidos, setEmitidos] = useState<ReporteEmitido[]>([]);
  const [sel, setSel] = useState<Record<string, boolean>>({}); // clase_id -> marcada
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState<{ id: string; folio: number } | null>(null);
  const [confirmar, setConfirmar] = useState<Prof | null>(null);
  const [anular, setAnular] = useState<ReporteEmitido | null>(null);
  const [motivo, setMotivo] = useState('');
  const [busy, setBusy] = useState(false);
  const [filtroDoc, setFiltroDoc] = useState('');

  const mismoMes = desde.slice(0, 7) === hasta.slice(0, 7);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const [h, f, c, p, e] = await Promise.all([
      supabase.rpc('reporte_horas', { p_desde: desde, p_hasta: hasta }),
      supabase.rpc('reporte_faltas', { p_desde: desde, p_hasta: hasta }),
      supabase.rpc('reporte_horas_clases', { p_desde: desde, p_hasta: hasta }),
      supabase.from('profiles').select('id, full_name, hourly_rate').eq('role', 'profesor').order('full_name'),
      supabase.from('reportes_horas').select('*').order('fecha_emision', { ascending: false }).limit(300),
    ]);
    const err = h.error || f.error || c.error || p.error;
    if (err) setError(err.message);
    setHoras(((h.data as ReporteHoras[]) || []).map((x) => ({
      ...x, hourly_rate: Number(x.hourly_rate), clases_impartidas: Number(x.clases_impartidas), retardos: Number(x.retardos),
      sin_salida: Number(x.sin_salida), minutos_pagables: Number(x.minutos_pagables),
    })));
    setFaltas((f.data as Falta[]) || []);
    const cl = ((c.data as ClaseHoras[]) || []).map((x) => ({
      ...x, sesiones_pendientes: Number(x.sesiones_pendientes), minutos_pendientes: Number(x.minutos_pendientes),
      sesiones_reportadas: Number(x.sesiones_reportadas), minutos_reportados: Number(x.minutos_reportados), sin_salida: Number(x.sin_salida),
      minutos_descontados: Number(x.minutos_descontados), faltas: Number(x.faltas), faltas_repuestas: Number(x.faltas_repuestas),
    }));
    setClases(cl);
    // por defecto: marcadas las clases que tienen horas pendientes (máx. 7 por docente)
    const s: Record<string, boolean> = {};
    const cuenta: Record<string, number> = {};
    cl.forEach((x) => {
      if (x.sesiones_pendientes > 0 && (cuenta[x.profesor_id] || 0) < MAX_CLASES) {
        s[x.clase_id] = true;
        cuenta[x.profesor_id] = (cuenta[x.profesor_id] || 0) + 1;
      }
    });
    setSel(s);
    setProfs(((p.data as Prof[]) || []).map((x) => ({ ...x, hourly_rate: Number(x.hourly_rate) })));
    setEmitidos(((e.data as ReporteEmitido[]) || []).map((x) => ({ ...x, tarifa: Number(x.tarifa), monto: Number(x.monto) })));
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

  // una línea por docente, solo los que tienen clases con registros en el periodo
  const docentes = useMemo(() => {
    const por: Record<string, ClaseHoras[]> = {};
    clases.forEach((c) => (por[c.profesor_id] ||= []).push(c));
    return profs
      .filter((p) => por[p.id])
      .map((p) => ({ prof: p, clases: por[p.id] }))
      .filter((d) => !filtroDoc || d.prof.full_name.toLowerCase().includes(filtroDoc.toLowerCase()));
  }, [clases, profs, filtroDoc]);

  const resumenSel = (p: Prof, cs: ClaseHoras[]) => {
    const marc = cs.filter((c) => sel[c.clase_id] && c.sesiones_pendientes > 0);
    const min = marc.reduce((a, c) => a + c.minutos_pendientes, 0);
    const monto = marc.reduce((a, c) => a + Math.round((c.minutos_pendientes / 60) * p.hourly_rate * 100) / 100, 0);
    return { marc, min, monto, sesiones: marc.reduce((a, c) => a + c.sesiones_pendientes, 0) };
  };

  async function api(url: string, body: object) {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Ocurrió un error');
    return j;
  }

  async function abrirPdf(id: string, folio: number) {
    setError('');
    try {
      const r = await fetch(`/api/reportes/pdf?id=${id}`, { headers: { Authorization: `Bearer ${session?.access_token}` } });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'No se pudo generar el PDF');
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = `Reporte_horas_${String(folio).padStart(5, '0')}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function emitir() {
    if (!confirmar) return;
    const cs = clases.filter((c) => c.profesor_id === confirmar.id);
    const { marc } = resumenSel(confirmar, cs);
    setBusy(true);
    setError('');
    try {
      const j = await api('/api/reportes', { profesor_id: confirmar.id, desde, hasta, clase_ids: marc.map((c) => c.clase_id) });
      setConfirmar(null);
      setAviso({ id: j.id, folio: j.folio });
      await load();
      abrirPdf(j.id, j.folio);
    } catch (e) {
      setError((e as Error).message);
      setConfirmar(null);
    }
    setBusy(false);
  }

  async function anularReporte() {
    if (!anular) return;
    setBusy(true);
    setError('');
    try {
      await api('/api/reportes/anular', { id: anular.id, motivo });
      setAnular(null);
      setMotivo('');
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  function exportar() {
    if (tab === 'faltas') {
      downloadCSV(`faltas_${desde}_a_${hasta}.csv`, [
        ['Fecha', 'Profesor', 'Materia', 'Grupo', 'Plantel', 'Horario', 'Repuesta el'],
        ...faltas.map((f) => [f.fecha, f.profesor_nombre, f.materia, f.grupo, f.plantel, `${hhmm(f.hora_inicio)}-${hhmm(f.hora_fin)}`, f.repuesta_fecha || '']),
      ]);
    } else if (tab === 'emitidos') {
      downloadCSV('reportes_emitidos.csv', [
        ['Folio', 'Fecha de emisión', 'Profesor', 'Desde', 'Hasta', 'Horas', 'Monto', 'Estado', 'Motivo de anulación'],
        ...emitidos.map((r) => [r.folio, r.fecha_emision, r.profesor_nombre, r.desde, r.hasta, hours(r.total_minutos), r.monto.toFixed(2), r.estado, r.anulado_motivo || '']),
      ]);
    } else {
      downloadCSV(`horas_${desde}_a_${hasta}.csv`, [
        ['Profesor', 'Clases impartidas', 'Horas a pagar', 'Pago por hora', 'Monto', 'Retardos', 'Sin salida', 'Faltas'],
        ...horas.map((r) => [
          r.profesor_nombre, r.clases_impartidas, hours(r.minutos_pagables), r.hourly_rate,
          ((r.minutos_pagables / 60) * r.hourly_rate).toFixed(2), r.retardos, r.sin_salida, faltasPorProfe[r.profesor_id] || 0,
        ]),
      ]);
    }
  }

  const emitidosVis = emitidos.filter((r) => !filtroDoc || r.profesor_nombre.toLowerCase().includes(filtroDoc.toLowerCase()));

  return (
    <>
      <h1>Reportes de horas</h1>
      <p className="sub">Selecciona las clases que dio cada docente y genera su reporte de horas para pago.</p>

      {error && <div className="msg err">{error}</div>}
      {aviso && (
        <div className="msg ok">
          Reporte folio <strong>{aviso.folio}</strong> emitido.{' '}
          <button className="btn sm" onClick={() => abrirPdf(aviso.id, aviso.folio)}>Descargar PDF</button>
        </div>
      )}

      <div className="card">
        <div className="form-grid">
          <div><label>Desde</label><input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></div>
          <div><label>Hasta</label><input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></div>
          <div><label>Docente</label><input type="search" placeholder="Buscar…" value={filtroDoc} onChange={(e) => setFiltroDoc(e.target.value)} /></div>
          <button className="btn ghost" onClick={exportar} disabled={loading}>Exportar CSV (Excel)</button>
        </div>
        <div className="quick">
          <button className="btn ghost sm" onClick={() => { setDesde(mesIni(0)); setHasta(todayISO()); }}>Mes actual</button>
          <button className="btn ghost sm" onClick={() => { setDesde(mesIni(-1)); setHasta(mesFin(-1)); }}>Mes anterior</button>
        </div>
      </div>

      <div className="tabs">
        <button className={`tab ${tab === 'horas' ? 'active' : ''}`} onClick={() => setTab('horas')}>Horas por profesor</button>
        <button className={`tab ${tab === 'faltas' ? 'active' : ''}`} onClick={() => setTab('faltas')}>Faltas ({faltas.length})</button>
        <button className={`tab ${tab === 'emitidos' ? 'active' : ''}`} onClick={() => setTab('emitidos')}>Reportes emitidos ({emitidos.length})</button>
      </div>

      {tab === 'horas' && (
        <>
          {puedeEmitir && !mismoMes && (
            <div className="msg err">Para emitir un reporte el periodo debe estar dentro de un mismo mes. Usa «Mes actual» o «Mes anterior».</div>
          )}
          {loading && <div className="card empty">Calculando…</div>}
          {!loading && docentes.length === 0 && <div className="card empty">Sin registros en el periodo.</div>}
          {!loading && docentes.map(({ prof, clases: cs }) => {
            const r = resumenSel(prof, cs);
            const excede = r.marc.length > MAX_CLASES;
            const pendiente = cs.reduce((a, c) => a + c.sesiones_pendientes, 0);
            return (
              <div className="card docente" key={prof.id}>
                <div className="docente-head">
                  <div>
                    <strong className="docente-nombre">{prof.full_name}</strong>
                    <div className="sub" style={{ margin: 0, fontSize: '0.85rem' }}>
                      {money(prof.hourly_rate)} por hora
                      {faltasPorProfe[prof.id] ? <> · <span className="badge err">{faltasPorProfe[prof.id]} {faltasPorProfe[prof.id] === 1 ? "falta" : "faltas"}</span></> : null}
                    </div>
                  </div>
                  <div className="docente-total">
                    <div className="n">{money(r.monto)}</div>
                    <div className="l">{hours(r.min)} h · {r.sesiones} sesiones · {r.marc.length} clase(s)</div>
                  </div>
                </div>

                <div className="clases-lista">
                  {cs.map((c) => {
                    const hab = c.sesiones_pendientes > 0;
                    return (
                      <label key={c.clase_id} className={`clase-op ${hab ? '' : 'off'} ${sel[c.clase_id] ? 'on' : ''}`}>
                        <input
                          type="checkbox"
                          checked={!!sel[c.clase_id] && hab}
                          disabled={!hab || !puedeEmitir}
                          onChange={(e) => setSel((s) => ({ ...s, [c.clase_id]: e.target.checked }))}
                        />
                        <span className="clase-info">
                          <strong>{c.materia}</strong> <span className="badge">{c.grupo}</span>
                          <small>{c.plantel} · {DIAS[c.dia_semana]} {hhmm(c.hora_inicio)}–{hhmm(c.hora_fin)}</small>
                          {c.minutos_descontados > 0 && <small className="warn-txt">⏱ {c.minutos_descontados} min descontados por retardo (tolerancia {TOLERANCIA_MIN} min)</small>}
                          {c.faltas > 0 && <small className="warn-txt">✖ {c.faltas} falta(s){c.faltas_repuestas > 0 ? ` · ${c.faltas_repuestas} repuesta(s)` : ''}: aparecerán en el reporte</small>}
                          {c.sin_salida > 0 && <small className="warn-txt">⚠ {c.sin_salida} sesión(es) sin salida: no suman horas hasta corregirlas</small>}
                          {c.sesiones_reportadas > 0 && <small className="ok-txt">✓ {c.sesiones_reportadas} sesión(es) ya incluidas en el folio {c.folios}</small>}
                        </span>
                        <span className="clase-num">
                          {hab ? (
                            <>
                              <strong>{money(Math.round((c.minutos_pendientes / 60) * prof.hourly_rate * 100) / 100)}</strong>
                              <small>{hours(c.minutos_pendientes)} h · {c.sesiones_pendientes} ses.</small>
                            </>
                          ) : <small>{c.faltas > 0 && c.sesiones_reportadas === 0 ? 'Sin clases impartidas' : 'Sin horas pendientes'}</small>}
                        </span>
                      </label>
                    );
                  })}
                </div>

                <div className="docente-pie">
                  {puedeEmitir && pendiente > 0 && (
                    <span className="mini-links">
                      <button className="link" onClick={() => setSel((s) => { const n = { ...s }; cs.slice(0).forEach((c) => { if (c.sesiones_pendientes > 0) n[c.clase_id] = true; }); return n; })}>Marcar todas</button>
                      <button className="link" onClick={() => setSel((s) => { const n = { ...s }; cs.forEach((c) => { n[c.clase_id] = false; }); return n; })}>Quitar todas</button>
                    </span>
                  )}
                  {excede && <span className="warn-txt">El formato admite máximo {MAX_CLASES} clases por reporte.</span>}
                  {puedeEmitir ? (
                    <button className="btn accent" disabled={r.marc.length === 0 || excede || !mismoMes || !(prof.hourly_rate > 0)} onClick={() => setConfirmar(prof)}>
                      Generar reporte
                    </button>
                  ) : (
                    <span className="sub" style={{ margin: 0, fontSize: '0.85rem' }}>Solo consulta: los reportes los emite Administración.</span>
                  )}
                </div>
                {!(prof.hourly_rate > 0) && puedeEmitir && <div className="warn-txt" style={{ marginTop: 8 }}>Falta configurar el pago por hora de este profesor.</div>}
              </div>
            );
          })}
          <p className="sub" style={{ fontSize: '0.85rem' }}>
            Las horas van de la entrada a la salida registradas, sin exceder la duración programada. Hay {TOLERANCIA_MIN} min de tolerancia; con más
            retardo se descuenta todo el retardo. Las faltas de las clases elegidas se imprimen en el reporte. Una sesión solo puede estar en un reporte vigente: si
            algo se emitió mal, anula el reporte (pestaña «Reportes emitidos») y vuelve a emitirlo.
          </p>
        </>
      )}

      {tab === 'faltas' && (
        <div className="card">
          <div className="table-wrap">
            <table className="stack">
              <thead><tr><th>Fecha</th><th>Profesor</th><th>Materia</th><th>Grupo</th><th>Plantel</th><th>Horario</th><th>Reposición</th></tr></thead>
              <tbody>
                {loading && <tr><td colSpan={7} className="empty">Calculando…</td></tr>}
                {!loading && faltas.length === 0 && <tr><td colSpan={7} className="empty">Sin faltas en el periodo.</td></tr>}
                {!loading && faltas.map((f, i) => (
                  <tr key={i}>
                    <td data-label="Fecha">{fmtDate(f.fecha)}</td>
                    <td data-label="Profesor"><strong>{f.profesor_nombre}</strong></td>
                    <td data-label="Materia">{f.materia}</td>
                    <td data-label="Grupo">{f.grupo}</td>
                    <td data-label="Plantel">{f.plantel}</td>
                    <td data-label="Horario">{hhmm(f.hora_inicio)} – {hhmm(f.hora_fin)}</td>
                    <td data-label="Reposición">{f.repuesta_fecha ? <span className="badge ok">Repuesta {fmtDate(f.repuesta_fecha)}</span> : <span className="badge err">Pendiente</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="sub" style={{ margin: '12px 0 0', fontSize: '0.85rem' }}>
            Se considera falta una clase programada, ya concluida, sin ningún registro de entrada. Se puede reponer desde
            «Apertura de clases» (dentro de los siguientes 60 días). El sistema aún no conoce días inhábiles ni suspensiones: revísalos antes de descontar.
          </p>
        </div>
      )}

      {tab === 'emitidos' && (
        <div className="card">
          <div className="table-wrap">
            <table className="stack">
              <thead>
                <tr><th>Folio</th><th>Emitido</th><th>Docente</th><th>Periodo</th><th className="num">Horas</th><th className="num">Monto</th><th>Estado</th><th></th></tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={8} className="empty">Cargando…</td></tr>}
                {!loading && emitidosVis.length === 0 && <tr><td colSpan={8} className="empty">Aún no hay reportes emitidos.</td></tr>}
                {!loading && emitidosVis.map((r) => (
                  <tr key={r.id}>
                    <td data-label="Folio"><strong>{r.folio}</strong></td>
                    <td data-label="Emitido">{fmtDateTime(r.fecha_emision)}{r.emitido_por_nombre ? <small className="block">por {r.emitido_por_nombre}</small> : null}</td>
                    <td data-label="Docente"><strong>{r.profesor_nombre}</strong></td>
                    <td data-label="Periodo">{fmtDate(r.desde)} – {fmtDate(r.hasta)}</td>
                    <td data-label="Horas" className="num">{hours(r.total_minutos)}</td>
                    <td data-label="Monto" className="num"><strong>{money(r.monto)}</strong></td>
                    <td data-label="Estado">
                      {r.estado === 'vigente' ? <span className="badge ok">Vigente</span> : <span className="badge err" title={r.anulado_motivo || ''}>Anulado</span>}
                      {r.estado === 'anulado' && r.anulado_motivo && <small className="block">{r.anulado_motivo}</small>}
                    </td>
                    <td data-label="" className="actions">
                      <button className="btn ghost sm" onClick={() => abrirPdf(r.id, r.folio)}>PDF</button>
                      {puedeEmitir && r.estado === 'vigente' && <button className="btn danger sm" onClick={() => { setAnular(r); setMotivo(''); }}>Anular</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {confirmar && (() => {
        const cs = clases.filter((c) => c.profesor_id === confirmar.id);
        const r = resumenSel(confirmar, cs);
        return (
          <Modal title="Generar reporte de horas" subtitle={confirmar.full_name} onClose={() => !busy && setConfirmar(null)} locked={busy}>
            <p>Periodo: <strong>{fmtDate(desde)}</strong> al <strong>{fmtDate(hasta)}</strong></p>
            <ul className="resumen-clases">
              {r.marc.map((c) => (
                <li key={c.clase_id}>
                  <span>{c.materia} ({c.grupo})</span>
                  <span>{hours(c.minutos_pendientes)} h · {money(Math.round((c.minutos_pendientes / 60) * confirmar.hourly_rate * 100) / 100)}</span>
                </li>
              ))}
            </ul>
            {r.marc.some((c) => c.faltas > 0 || c.minutos_descontados > 0) && (
              <p className="sub" style={{ marginTop: 0 }}>
                Se imprimirá en el reporte: {r.marc.reduce((a, c) => a + c.faltas, 0)} falta(s) y {r.marc.reduce((a, c) => a + c.minutos_descontados, 0)} min descontados por retardo.
              </p>
            )}
            <p><strong>Total: {hours(r.min)} h · {money(r.monto)}</strong></p>
            <p className="sub">Se asignará un folio y un sello digital. Estas sesiones quedarán ligadas al reporte y no podrán incluirse en otro, salvo que lo anules.</p>
            <div className="modal-actions">
              <button className="btn ghost" onClick={() => setConfirmar(null)} disabled={busy}>Cancelar</button>
              <button className="btn accent" onClick={emitir} disabled={busy}>{busy ? 'Generando…' : 'Emitir y descargar PDF'}</button>
            </div>
          </Modal>
        );
      })()}

      {anular && (
        <Modal title={`Anular reporte folio ${anular.folio}`} subtitle={anular.profesor_nombre} onClose={() => !busy && setAnular(null)} locked={busy}>
          <p className="sub">Las sesiones quedarán libres para incluirse en un nuevo reporte. El folio anulado no se reutiliza y queda en la bitácora.</p>
          <label>Motivo de la anulación</label>
          <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej. Tarifa incorrecta" maxLength={200} />
          <div className="modal-actions" style={{ marginTop: 14 }}>
            <button className="btn ghost" onClick={() => setAnular(null)} disabled={busy}>Cancelar</button>
            <button className="btn danger" onClick={anularReporte} disabled={busy || motivo.trim().length < 5}>{busy ? 'Anulando…' : 'Anular reporte'}</button>
          </div>
        </Modal>
      )}
    </>
  );
}
