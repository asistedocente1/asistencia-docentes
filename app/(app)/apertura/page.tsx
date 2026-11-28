'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { capturePhoto } from '@/lib/camera';
import { MODALIDAD_LABEL, PLANTELES, REQUIRE_PHOTO } from '@/lib/config';
import { fmtTime, hhmm, toMin } from '@/lib/format';
import type { AperturaRow } from '@/lib/types';
import Modal from '@/components/Modal';

type Estado = 'por_abrir' | 'disponible' | 'en_curso' | 'concluida' | 'sin_registro';

const CAMARA_MSG =
  'No se pudo usar la cámara. Permite el acceso a la cámara en el navegador para registrar la asistencia.';

/** El estado se calcula con la hora del SERVIDOR (r.ahora), no con el reloj del equipo */
function estadoDe(r: AperturaRow): Estado {
  if (r.asistencia_id) return r.salida ? 'concluida' : 'en_curso';
  const ahora = toMin(r.ahora);
  if (ahora < toMin(r.hora_inicio) - 30) return 'por_abrir';
  if (ahora >= toMin(r.hora_fin)) return 'sin_registro';
  return 'disponible';
}

const ETIQUETA: Record<Estado, { texto: string; clase: string }> = {
  por_abrir: { texto: 'Aún no disponible', clase: '' },
  disponible: { texto: 'Disponible', clase: 'ok' },
  en_curso: { texto: 'En curso', clase: 'warn' },
  concluida: { texto: 'Concluida', clase: 'ok' },
  sin_registro: { texto: 'Sin registro', clase: 'err' },
};

interface Dialogo {
  row: AperturaRow;
  accion: 'abrir' | 'cerrar';
  foto: Blob | null;
}

export default function AperturaPage() {
  const { profile, session } = useAuth();
  const [rows, setRows] = useState<AperturaRow[]>([]);
  const [cargando, setCargando] = useState(true);
  const [plantel, setPlantel] = useState('');
  const [buscar, setBuscar] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; m: string } | null>(null);
  const [dlg, setDlg] = useState<Dialogo | null>(null);
  const [password, setPassword] = useState('');
  const [dlgBusy, setDlgBusy] = useState(false);
  const [dlgErr, setDlgErr] = useState('');

  // Recuerda el plantel elegido en este equipo (comodidad, no es información sensible)
  useEffect(() => {
    try {
      setPlantel(localStorage.getItem('apertura.plantel') || '');
    } catch {
      /* sin almacenamiento: se usa "todos" */
    }
  }, []);
  const elegirPlantel = (p: string) => {
    setPlantel(p);
    try {
      localStorage.setItem('apertura.plantel', p);
    } catch {
      /* ignora */
    }
  };

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('apertura_del_dia');
    if (error) setMsg({ t: 'err', m: error.message });
    else setRows((data as AperturaRow[]) || []);
    setCargando(false);
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    const onVisible = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  async function subirFoto(asistenciaId: string, tipo: 'entrada' | 'salida', foto: Blob | null) {
    if (!foto || !profile) return !REQUIRE_PHOTO;
    const path = `${profile.id}/${asistenciaId}-${tipo}.jpg`;
    const up = await supabase.storage.from('asistencia-fotos').upload(path, foto, { contentType: 'image/jpeg', upsert: false });
    if (up.error) return false;
    const { error } = await supabase.rpc('adjuntar_foto_apertura', { p_asistencia_id: asistenciaId, p_tipo: tipo, p_path: path });
    return !error;
  }

  const avisoFinal = (accion: 'abrir' | 'cerrar', okFoto: boolean, r: AperturaRow) =>
    okFoto
      ? { t: 'ok' as const, m: `${accion === 'abrir' ? 'Entrada' : 'Salida'} registrada: ${r.profesor_nombre} · ${r.materia}.` }
      : { t: 'err' as const, m: 'Se registró la hora, pero no se pudo guardar la foto. Avisa a sistemas.' };

  /** Clases presenciales: un solo toque (la foto se toma en ese momento, sin vista previa) */
  async function registrarPresencial(r: AperturaRow, accion: 'abrir' | 'cerrar', fotoPrevia?: Blob | null) {
    setBusy(r.clase_id);
    setMsg(null);
    try {
      const foto = fotoPrevia !== undefined ? fotoPrevia : await capturePhoto();
      if (!foto && REQUIRE_PHOTO) throw new Error(CAMARA_MSG);

      const { data, error } = await supabase.rpc(accion === 'abrir' ? 'abrir_clase' : 'cerrar_clase', { p_clase_id: r.clase_id });
      if (error) throw new Error(error.message);

      const okFoto = await subirFoto(data as string, accion === 'abrir' ? 'entrada' : 'salida', foto);
      setMsg(avisoFinal(accion, okFoto, r));
    } catch (e) {
      setMsg({ t: 'err', m: (e as Error).message });
    } finally {
      setBusy(null);
      load();
    }
  }

  async function alTocar(r: AperturaRow) {
    if (busy || dlg) return;
    const est = estadoDe(r);
    setMsg(null);

    if (est === 'disponible' && r.modalidad === 'presencial') {
      await registrarPresencial(r, 'abrir');
      return;
    }
    if (est === 'disponible' || est === 'en_curso') {
      // En línea (contraseña) o cierre presencial (confirmación): la foto se toma al tocar
      setBusy(r.clase_id);
      const foto = await capturePhoto();
      setBusy(null);
      if (!foto && REQUIRE_PHOTO) {
        setMsg({ t: 'err', m: CAMARA_MSG });
        return;
      }
      setPassword('');
      setDlgErr('');
      setDlg({ row: r, accion: est === 'disponible' ? 'abrir' : 'cerrar', foto });
    }
  }

  async function confirmar(e: FormEvent) {
    e.preventDefault();
    if (!dlg) return;
    const { row, accion, foto } = dlg;

    // Cierre de clase presencial: solo confirmación
    if (row.modalidad === 'presencial') {
      setDlg(null);
      await registrarPresencial(row, accion, foto);
      return;
    }

    // En línea: contraseña del profesor, verificada en el servidor
    setDlgBusy(true);
    setDlgErr('');
    try {
      const resp = await fetch('/api/apertura', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ clase_id: row.clase_id, accion, password }),
      });
      const j = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        setDlgErr(j.error || 'No se pudo registrar.');
        setPassword('');
        setDlgBusy(false);
        return;
      }
      const okFoto = await subirFoto(j.asistencia_id as string, accion === 'abrir' ? 'entrada' : 'salida', foto);
      setDlg(null);
      setMsg(avisoFinal(accion, okFoto, row));
      load();
    } catch {
      setDlgErr('Error de conexión. Inténtalo de nuevo.');
    }
    setDlgBusy(false);
  }

  const lista = useMemo(() => {
    const q = buscar.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (!plantel || r.plantel === plantel) &&
        (!q || `${r.profesor_nombre} ${r.materia} ${r.grupo}`.toLowerCase().includes(q))
    );
  }, [rows, plantel, buscar]);

  const planteles = useMemo(() => Array.from(new Set([...PLANTELES, ...rows.map((r) => r.plantel)])), [rows]);
  const disponibles = lista.filter((r) => estadoDe(r) === 'disponible').length;
  const enCurso = lista.filter((r) => estadoDe(r) === 'en_curso').length;

  const hoyTxt = new Date().toLocaleDateString('es-MX', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Mexico_City',
  });
  const hoy = hoyTxt.charAt(0).toUpperCase() + hoyTxt.slice(1);

  return (
    <>
      <h1>Apertura de clases</h1>
      <p className="sub">
        {hoy} · {disponibles} por abrir · {enCurso} en curso
      </p>

      {msg && <div className={`msg ${msg.t}`}>{msg.m}</div>}

      <div className="card filters">
        <div>
          <label>Plantel</label>
          <select value={plantel} onChange={(e) => elegirPlantel(e.target.value)}>
            <option value="">Todos</option>
            {planteles.map((p) => <option key={p}>{p}</option>)}
          </select>
        </div>
        <div>
          <label>Buscar profesor o materia</label>
          <input type="search" value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Escribe para filtrar…" />
        </div>
      </div>

      {cargando && <div className="card empty">Cargando clases…</div>}
      {!cargando && lista.length === 0 && <div className="card empty">No hay clases programadas hoy con este filtro.</div>}

      <div className="tiles">
        {lista.map((r) => {
          const est = estadoDe(r);
          const activa = est === 'disponible' || est === 'en_curso';
          const et = ETIQUETA[est];
          const trabajando = busy === r.clase_id;
          return (
            <button
              key={r.clase_id}
              type="button"
              className={`tile ${est}`}
              disabled={!activa || !!busy || !!dlg}
              onClick={() => alTocar(r)}
            >
              <span className="tile-time">{hhmm(r.hora_inicio)} – {hhmm(r.hora_fin)}</span>
              <span className="tile-title">{r.materia}</span>
              <span className="tile-prof">{r.profesor_nombre}</span>
              <span className="tile-meta">{r.grupo} · {r.plantel}</span>
              <span className="tile-badges">
                <span className={`badge ${r.modalidad === 'en_linea' ? 'warn' : ''}`}>{MODALIDAD_LABEL[r.modalidad]}</span>
                <span className={`badge ${et.clase}`}>{et.texto}</span>
                {r.retardo_min ? <span className="badge err">Retardo {r.retardo_min} min</span> : null}
              </span>
              <span className="tile-hint">
                {trabajando && 'Registrando…'}
                {!trabajando && est === 'disponible' && (r.modalidad === 'en_linea' ? 'Toca para abrir (pedirá contraseña)' : 'Toca para registrar entrada')}
                {!trabajando && est === 'en_curso' && `Entrada ${fmtTime(r.entrada)} · toca para registrar salida`}
                {!trabajando && est === 'concluida' && `${fmtTime(r.entrada)} → ${fmtTime(r.salida)}`}
                {!trabajando && est === 'por_abrir' && `Se habilita a las ${minToHHMM(toMin(r.hora_inicio) - 30)}`}
                {!trabajando && est === 'sin_registro' && 'La clase terminó sin registro'}
              </span>
            </button>
          );
        })}
      </div>

      {dlg && (
        <Modal
          title={dlg.accion === 'abrir' ? 'Abrir clase en línea' : dlg.row.modalidad === 'presencial' ? 'Registrar salida' : 'Registrar salida (en línea)'}
          subtitle={`${dlg.row.materia} · ${dlg.row.profesor_nombre}`}
          onClose={() => setDlg(null)}
          locked={dlgBusy}
        >
          <form onSubmit={confirmar} className="stack-form">
            {dlgErr && <div className="msg err" style={{ margin: 0 }}>{dlgErr}</div>}
            {dlg.row.modalidad === 'en_linea' ? (
              <div>
                <label htmlFor="pw">
                  {dlg.row.profesor_nombre}, escribe tu contraseña del sistema para {dlg.accion === 'abrir' ? 'abrir' : 'cerrar'} tu clase
                </label>
                <input
                  id="pw"
                  type="password"
                  autoFocus
                  required
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            ) : (
              <p style={{ margin: 0 }}>
                ¿Registrar la salida de <strong>{dlg.row.profesor_nombre}</strong> en <strong>{dlg.row.materia}</strong>?
                Esto cierra la clase.
              </p>
            )}
            <div className="modal-actions">
              <button type="button" className="btn ghost" onClick={() => setDlg(null)} disabled={dlgBusy}>Cancelar</button>
              <button className="btn" disabled={dlgBusy}>
                {dlgBusy ? 'Verificando…' : dlg.row.modalidad === 'en_linea' ? 'Confirmar' : 'Registrar salida'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

function minToHHMM(total: number) {
  const m = ((total % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
