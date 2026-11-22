'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { ROLE_LABEL } from '@/lib/config';
import { downloadCSV } from '@/lib/csv';
import { addDays, fmtDateTime, hhmm, todayISO } from '@/lib/format';
import type { BitacoraRow, Profile, Role } from '@/lib/types';

// México no tiene horario de verano desde 2022: UTC-6 todo el año
const OFFSET = '-06:00';

const CATEGORIAS: { id: string; label: string; acciones: string[] }[] = [
  { id: '', label: 'Todas las acciones', acciones: [] },
  { id: 'sesiones', label: 'Inicios de sesión', acciones: ['sesion.inicio'] },
  { id: 'usuarios', label: 'Usuarios', acciones: ['usuario.crear', 'usuario.editar', 'usuario.activar', 'usuario.desactivar'] },
  { id: 'horarios', label: 'Clases y horarios', acciones: ['clase.crear', 'clase.editar', 'clase.activar', 'clase.desactivar', 'clase.eliminar'] },
  { id: 'aperturas', label: 'Aperturas y cierres de clase', acciones: ['clase.abrir', 'clase.cerrar'] },
  { id: 'seguridad', label: 'Contraseñas incorrectas', acciones: ['apertura.password_fallida'] },
];

const ACCION: Record<string, { label: string; clase: string }> = {
  'sesion.inicio': { label: 'Inicio de sesión', clase: '' },
  'usuario.crear': { label: 'Alta de usuario', clase: 'ok' },
  'usuario.editar': { label: 'Edición de usuario', clase: 'warn' },
  'usuario.activar': { label: 'Usuario activado', clase: 'ok' },
  'usuario.desactivar': { label: 'Usuario desactivado', clase: 'err' },
  'clase.crear': { label: 'Alta de clase', clase: 'ok' },
  'clase.editar': { label: 'Edición de clase', clase: 'warn' },
  'clase.activar': { label: 'Clase activada', clase: 'ok' },
  'clase.desactivar': { label: 'Clase desactivada', clase: 'err' },
  'clase.eliminar': { label: 'Clase eliminada', clase: 'err' },
  'clase.abrir': { label: 'Apertura de clase', clase: 'ok' },
  'clase.cerrar': { label: 'Cierre de clase', clase: 'ok' },
  'apertura.password_fallida': { label: 'Contraseña incorrecta', clase: 'err' },
};

const CAMPO: Record<string, string> = {
  materia: 'Materia', grupo: 'Grupo', plantel: 'Plantel', hora_inicio: 'Hora de inicio', hora_fin: 'Hora de fin',
  activo: 'Activa', modalidad: 'Modalidad', profesor: 'Profesor', dia: 'Día', nombre: 'Nombre', correo: 'Correo',
  rol: 'Rol', pago_por_hora: 'Pago por hora', estado: 'Estado', contrasena: 'Contraseña', metodo: 'Método',
  retardo_min: 'Retardo (min)',
};
const OCULTOS = new Set(['id', 'clase_id', 'profesor_id', 'created_at']);

function valor(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Sí' : 'No';
  if (typeof v === 'string') {
    if (v === 'en_linea') return 'En línea';
    if (v === 'presencial') return 'Presencial';
    if (/^\d{2}:\d{2}(:\d{2})?$/.test(v)) return hhmm(v);
    return v;
  }
  return String(v);
}

function lineasDetalle(d: Record<string, unknown> | null): string[] {
  if (!d) return [];
  return Object.entries(d)
    .filter(([k]) => !OCULTOS.has(k))
    .map(([k, v]) => {
      const etiqueta = CAMPO[k] || k;
      if (v && typeof v === 'object' && 'antes' in (v as object)) {
        const c = v as { antes: unknown; despues: unknown };
        return `${etiqueta}: ${valor(c.antes)} → ${valor(c.despues)}`;
      }
      return `${etiqueta}: ${valor(v)}`;
    });
}

export default function BitacoraPage() {
  const [desde, setDesde] = useState(addDays(todayISO(), -7));
  const [hasta, setHasta] = useState(todayISO());
  const [actor, setActor] = useState('');
  const [cat, setCat] = useState('');
  const [texto, setTexto] = useState('');
  const [personas, setPersonas] = useState<Pick<Profile, 'id' | 'full_name' | 'role'>[]>([]);
  const [rows, setRows] = useState<BitacoraRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    supabase.from('profiles').select('id, full_name, role').order('full_name')
      .then(({ data }) => setPersonas((data as Pick<Profile, 'id' | 'full_name' | 'role'>[]) || []));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    let q = supabase
      .from('bitacora')
      .select('*')
      .gte('created_at', `${desde}T00:00:00${OFFSET}`)
      .lt('created_at', `${addDays(hasta, 1)}T00:00:00${OFFSET}`)
      .order('created_at', { ascending: false })
      .limit(500);
    if (actor) q = q.eq('actor_id', actor);
    const acciones = CATEGORIAS.find((c) => c.id === cat)?.acciones || [];
    if (acciones.length) q = q.in('accion', acciones);
    const { data, error } = await q;
    if (error) setError(error.message);
    setRows((data as BitacoraRow[]) || []);
    setLoading(false);
  }, [desde, hasta, actor, cat]);

  useEffect(() => {
    load();
  }, [load]);

  const visibles = useMemo(() => {
    const t = texto.trim().toLowerCase();
    if (!t) return rows;
    return rows.filter((r) => `${r.actor_nombre ?? ''} ${r.resumen ?? ''}`.toLowerCase().includes(t));
  }, [rows, texto]);

  function exportar() {
    downloadCSV(`bitacora_${desde}_a_${hasta}.csv`, [
      ['Fecha y hora', 'Usuario', 'Rol', 'Acción', 'Detalle'],
      ...visibles.map((r) => [
        fmtDateTime(r.created_at),
        r.actor_nombre ?? '(sistema)',
        r.actor_rol ? ROLE_LABEL[r.actor_rol as Role] ?? r.actor_rol : '',
        ACCION[r.accion]?.label ?? r.accion,
        r.resumen ?? '',
      ]),
    ]);
  }

  return (
    <>
      <h1>Bitácora</h1>
      <p className="sub">Registro de qué usuario hizo qué y cuándo. No se puede editar ni borrar desde el sistema.</p>

      {error && <div className="msg err">{error}</div>}

      <div className="card">
        <div className="form-grid">
          <div><label>Desde</label><input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></div>
          <div><label>Hasta</label><input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></div>
          <div>
            <label>Usuario</label>
            <select value={actor} onChange={(e) => setActor(e.target.value)}>
              <option value="">Todos</option>
              {personas.map((p) => <option key={p.id} value={p.id}>{p.full_name} · {ROLE_LABEL[p.role]}</option>)}
            </select>
          </div>
          <div>
            <label>Tipo de acción</label>
            <select value={cat} onChange={(e) => setCat(e.target.value)}>
              {CATEGORIAS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </div>
          <div>
            <label>Buscar en el detalle</label>
            <input type="search" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Nombre, materia…" />
          </div>
          <button className="btn ghost" onClick={exportar} disabled={loading || visibles.length === 0}>Exportar CSV</button>
        </div>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table className="stack">
            <thead>
              <tr><th>Fecha y hora</th><th>Usuario</th><th>Acción</th><th>Detalle</th></tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={4} className="empty">Cargando…</td></tr>}
              {!loading && visibles.length === 0 && <tr><td colSpan={4} className="empty">Sin movimientos en el periodo.</td></tr>}
              {!loading && visibles.map((r) => {
                const a = ACCION[r.accion] ?? { label: r.accion, clase: '' };
                const lineas = lineasDetalle(r.detalle);
                return (
                  <tr key={r.id}>
                    <td data-label="Fecha y hora" className="nowrap">{fmtDateTime(r.created_at)}</td>
                    <td data-label="Usuario">
                      <strong>{r.actor_nombre ?? '(sistema)'}</strong>
                      {r.actor_rol && <div className="meta">{ROLE_LABEL[r.actor_rol as Role] ?? r.actor_rol}</div>}
                    </td>
                    <td data-label="Acción"><span className={`badge ${a.clase}`}>{a.label}</span></td>
                    <td data-label="Detalle" className="detalle">
                      <div>{r.resumen}</div>
                      {lineas.length > 0 && r.accion !== 'clase.abrir' && r.accion !== 'clase.cerrar' && (
                        <details>
                          <summary>Ver cambios</summary>
                          <ul>{lineas.map((l, i) => <li key={i}>{l}</li>)}</ul>
                        </details>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {rows.length === 500 && <p className="sub" style={{ marginTop: 10 }}>Mostrando los 500 movimientos más recientes; acota el rango de fechas o el usuario.</p>}
      </div>
    </>
  );
}
