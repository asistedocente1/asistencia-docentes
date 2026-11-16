'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { capturePhoto } from '@/lib/camera';
import { DIAS, REQUIRE_PHOTO } from '@/lib/config';
import { fmtDate, fmtTime, hhmm, hours, isoWeekday, todayISO } from '@/lib/format';
import type { Asistencia, AsistenciaDetalle, Clase } from '@/lib/types';

export default function MiAsistenciaPage() {
  const { profile } = useAuth();
  const [clases, setClases] = useState<Clase[]>([]);
  const [reg, setReg] = useState<Record<string, Asistencia>>({});
  const [hist, setHist] = useState<AsistenciaDetalle[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; m: string } | null>(null);

  const load = useCallback(async () => {
    if (!profile) return;
    const [c, a, h] = await Promise.all([
      supabase.from('clases').select('*').eq('profesor_id', profile.id).eq('activo', true)
        .eq('dia_semana', isoWeekday()).order('hora_inicio'),
      supabase.from('asistencias').select('*').eq('profesor_id', profile.id).eq('fecha', todayISO()),
      supabase.from('asistencias_detalle').select('*').eq('profesor_id', profile.id)
        .order('entrada', { ascending: false }).limit(15),
    ]);
    setClases((c.data as Clase[]) || []);
    const map: Record<string, Asistencia> = {};
    ((a.data as Asistencia[]) || []).forEach((x) => (map[x.clase_id] = x));
    setReg(map);
    setHist((h.data as AsistenciaDetalle[]) || []);
  }, [profile]);

  useEffect(() => {
    load();
  }, [load]);

  async function subirFoto(id: string, tipo: 'entrada' | 'salida', foto: Blob | null) {
    if (!foto || !profile) return true;
    const path = `${profile.id}/${id}-${tipo}.jpg`;
    const up = await supabase.storage.from('asistencia-fotos').upload(path, foto, { contentType: 'image/jpeg', upsert: false });
    if (up.error) return false;
    const { error } = await supabase.rpc('adjuntar_foto', { p_asistencia_id: id, p_tipo: tipo, p_path: path });
    return !error;
  }

  async function registrar(tipo: 'entrada' | 'salida', clase: Clase, asistencia?: Asistencia) {
    setBusy(clase.id);
    setMsg(null);
    try {
      // 1) Foto discreta en el momento del toque
      const foto = await capturePhoto();
      if (!foto && REQUIRE_PHOTO) {
        throw new Error('Para registrar tu asistencia debes permitir el acceso a la cámara en tu navegador.');
      }

      // 2) La hora la fija el servidor, no el celular
      let id: string;
      if (tipo === 'entrada') {
        const { data, error } = await supabase.rpc('registrar_entrada', { p_clase_id: clase.id });
        if (error) throw new Error(error.message);
        id = data as string;
      } else {
        id = asistencia!.id;
        const { error } = await supabase.rpc('registrar_salida', { p_asistencia_id: id });
        if (error) throw new Error(error.message);
      }

      // 3) Guarda la foto
      const okFoto = await subirFoto(id, tipo, foto);
      setMsg(
        okFoto
          ? { t: 'ok', m: tipo === 'entrada' ? 'Entrada registrada.' : 'Salida registrada.' }
          : { t: 'err', m: 'Se registró la hora, pero no se pudo guardar la foto. Avisa a sistemas.' }
      );
    } catch (e) {
      setMsg({ t: 'err', m: (e as Error).message });
    } finally {
      setBusy(null);
      load();
    }
  }

  const hoy = new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Mexico_City' });

  return (
    <>
      <h1>Mi asistencia</h1>
      <p className="sub" style={{ textTransform: 'capitalize' }}>{hoy}</p>

      {msg && <div className={`msg ${msg.t}`}>{msg.m}</div>}

      <h2>Mis clases de hoy</h2>
      {clases.length === 0 && <div className="card empty">No tienes clases programadas para hoy ({DIAS[isoWeekday()]}).</div>}

      {clases.map((c) => {
        const a = reg[c.id];
        return (
          <div key={c.id} className="card clase">
            <div className="info">
              <div className="title">{c.materia}</div>
              <div className="meta">{c.grupo} · {c.plantel}</div>
              <div className="meta"><strong>{hhmm(c.hora_inicio)} – {hhmm(c.hora_fin)}</strong></div>
              {a && (
                <div className="meta" style={{ marginTop: 6 }}>
                  Entrada: <strong>{fmtTime(a.entrada)}</strong>
                  {a.retardo_min > 0 && <> <span className="badge warn">Retardo {a.retardo_min} min</span></>}
                  {a.salida && <> · Salida: <strong>{fmtTime(a.salida)}</strong></>}
                </div>
              )}
            </div>
            <div className="action">
              {!a && (
                <button className="btn big" disabled={busy === c.id} onClick={() => registrar('entrada', c)}>
                  {busy === c.id ? 'Registrando…' : 'Registrar entrada'}
                </button>
              )}
              {a && !a.salida && (
                <button className="btn big accent" disabled={busy === c.id} onClick={() => registrar('salida', c, a)}>
                  {busy === c.id ? 'Registrando…' : 'Registrar salida'}
                </button>
              )}
              {a?.salida && <span className="badge ok">Clase completada</span>}
            </div>
          </div>
        );
      })}

      <div className="card">
        <h2>Mis últimos registros</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Fecha</th><th>Materia</th><th>Entrada</th><th>Salida</th>
                <th className="num">Horas</th>
              </tr>
            </thead>
            <tbody>
              {hist.length === 0 && <tr><td colSpan={5} className="empty">Sin registros todavía.</td></tr>}
              {hist.map((h) => (
                <tr key={h.id}>
                  <td>{fmtDate(h.fecha)}</td>
                  <td>{h.materia} <span className="meta">· {h.grupo}</span></td>
                  <td>{fmtTime(h.entrada)}</td>
                  <td>{h.salida ? fmtTime(h.salida) : <span className="badge warn">Sin salida</span>}</td>
                  <td className="num">{hours(h.minutos_pagables)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
