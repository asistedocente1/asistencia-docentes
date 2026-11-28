'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { DIAS, MODALIDAD_LABEL, PLANTELES } from '@/lib/config';
import { hhmm } from '@/lib/format';
import type { Clase, Modalidad, Profile } from '@/lib/types';

const VACIO = {
  profesor_id: '',
  materia: '',
  grupo: '',
  plantel: PLANTELES[0],
  dia_semana: 1,
  hora_inicio: '08:00',
  hora_fin: '10:00',
  modalidad: 'presencial' as Modalidad,
};

export default function ClasesPage() {
  const [profes, setProfes] = useState<Profile[]>([]);
  const [clases, setClases] = useState<Clase[]>([]);
  const [filtro, setFiltro] = useState('');
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; m: string } | null>(null);
  const [form, setForm] = useState({ ...VACIO });
  const [editId, setEditId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const [p, c] = await Promise.all([
      supabase.from('profiles').select('*').eq('role', 'profesor').order('full_name'),
      supabase.from('clases').select('*, profiles(full_name)').order('dia_semana').order('hora_inicio'),
    ]);
    setProfes((p.data as Profile[]) || []);
    setClases((c.data as Clase[]) || []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function startEdit(c: Clase) {
    setEditId(c.id);
    setMsg(null);
    setForm({
      profesor_id: c.profesor_id,
      materia: c.materia,
      grupo: c.grupo,
      plantel: c.plantel,
      dia_semana: c.dia_semana,
      hora_inicio: hhmm(c.hora_inicio),
      hora_fin: hhmm(c.hora_fin),
      modalidad: c.modalidad,
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function cancelEdit() {
    setEditId(null);
    setForm({ ...VACIO });
    setMsg(null);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!form.profesor_id) return setMsg({ t: 'err', m: 'Selecciona un profesor.' });
    if (form.hora_fin <= form.hora_inicio) return setMsg({ t: 'err', m: 'La hora de fin debe ser posterior a la de inicio.' });

    setSaving(true);
    const payload = { ...form, dia_semana: Number(form.dia_semana) };
    const { error } = editId
      ? await supabase.from('clases').update(payload).eq('id', editId)
      : await supabase.from('clases').insert(payload);
    setSaving(false);
    if (error) return setMsg({ t: 'err', m: error.message });

    if (editId) {
      setMsg({ t: 'ok', m: 'Cambios guardados. Lo ya registrado en asistencias conserva el horario con el que se registró.' });
      setEditId(null);
      setForm({ ...VACIO });
    } else {
      setMsg({ t: 'ok', m: 'Clase agregada.' });
      setForm({ ...form, materia: '', grupo: '' });
    }
    load();
  }

  async function toggle(c: Clase) {
    const { error } = await supabase.from('clases').update({ activo: !c.activo }).eq('id', c.id);
    if (error) setMsg({ t: 'err', m: error.message });
    load();
  }

  const lista = clases.filter((c) => !filtro || c.profesor_id === filtro);
  // Para altas solo profesores activos; al editar se conserva el asignado aunque esté inactivo
  const opcionesProfe = profes.filter((p) => p.active || p.id === form.profesor_id);

  return (
    <>
      <h1>Clases y horarios</h1>
      <p className="sub">El profesor solo verá y podrá registrar las clases que le asignes aquí, el día que le toquen.</p>

      {msg && <div className={`msg ${msg.t}`}>{msg.m}</div>}

      <div className="card" style={editId ? { borderColor: 'var(--accent)', borderWidth: 2 } : undefined}>
        <h2>{editId ? 'Editando clase' : 'Nueva clase'}</h2>
        <form onSubmit={onSubmit} className="form-grid">
          <div>
            <label>Profesor</label>
            <select required value={form.profesor_id} onChange={(e) => setForm({ ...form, profesor_id: e.target.value })}>
              <option value="">Selecciona…</option>
              {opcionesProfe.map((p) => (
                <option key={p.id} value={p.id}>{p.full_name}{p.active ? '' : ' (inactivo)'}</option>
              ))}
            </select>
          </div>
          <div>
            <label>Materia</label>
            <input required value={form.materia} onChange={(e) => setForm({ ...form, materia: e.target.value })} />
          </div>
          <div>
            <label>Grupo / programa</label>
            <input required value={form.grupo} onChange={(e) => setForm({ ...form, grupo: e.target.value })} />
          </div>
          <div>
            <label>Plantel</label>
            <select value={form.plantel} onChange={(e) => setForm({ ...form, plantel: e.target.value })}>
              {Array.from(new Set([...PLANTELES, form.plantel])).map((p) => <option key={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label>Modalidad</label>
            <select value={form.modalidad} onChange={(e) => setForm({ ...form, modalidad: e.target.value as Modalidad })}>
              <option value="presencial">{MODALIDAD_LABEL.presencial}</option>
              <option value="en_linea">{MODALIDAD_LABEL.en_linea} (pide contraseña al abrir)</option>
            </select>
          </div>
          <div>
            <label>Día</label>
            <select value={form.dia_semana} onChange={(e) => setForm({ ...form, dia_semana: Number(e.target.value) })}>
              {DIAS.slice(1).map((d, i) => <option key={d} value={i + 1}>{d}</option>)}
            </select>
          </div>
          <div>
            <label>Inicio</label>
            <input type="time" required value={form.hora_inicio} onChange={(e) => setForm({ ...form, hora_inicio: e.target.value })} />
          </div>
          <div>
            <label>Fin</label>
            <input type="time" required value={form.hora_fin} onChange={(e) => setForm({ ...form, hora_fin: e.target.value })} />
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn" disabled={saving} style={{ flex: 1 }}>
              {saving ? 'Guardando…' : editId ? 'Guardar cambios' : 'Agregar clase'}
            </button>
            {editId && (
              <button type="button" className="btn ghost" onClick={cancelEdit} disabled={saving}>Cancelar</button>
            )}
          </div>
        </form>
      </div>

      <div className="card">
        <div className="row between" style={{ marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>Horarios ({lista.length})</h2>
          <select value={filtro} onChange={(e) => setFiltro(e.target.value)} className="filter-select">
            <option value="">Todos los profesores</option>
            {profes.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </select>
        </div>
        <div className="table-wrap">
          <table className="stack">
            <thead>
              <tr>
                <th>Profesor</th>
                <th>Materia</th>
                <th>Grupo</th>
                <th>Plantel</th>
                <th>Modalidad</th>
                <th>Día</th>
                <th>Horario</th>
                <th>Estado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {lista.length === 0 && <tr><td colSpan={9} className="empty">No hay clases registradas.</td></tr>}
              {lista.map((c) => (
                <tr key={c.id} style={{ opacity: c.activo ? 1 : 0.55, outline: c.id === editId ? '2px solid var(--accent)' : undefined }}>
                  <td data-label="Profesor"><strong>{c.profiles?.full_name}</strong></td>
                  <td data-label="Materia">{c.materia}</td>
                  <td data-label="Grupo">{c.grupo}</td>
                  <td data-label="Plantel">{c.plantel}</td>
                  <td data-label="Modalidad">
                    <span className={`badge ${c.modalidad === 'en_linea' ? 'warn' : ''}`}>{MODALIDAD_LABEL[c.modalidad]}</span>
                  </td>
                  <td data-label="Día">{DIAS[c.dia_semana]}</td>
                  <td data-label="Horario">{hhmm(c.hora_inicio)} – {hhmm(c.hora_fin)}</td>
                  <td data-label="Estado"><span className={`badge ${c.activo ? 'ok' : 'err'}`}>{c.activo ? 'Activa' : 'Inactiva'}</span></td>
                  <td className="actions">
                    <button className="btn sm" onClick={() => startEdit(c)}>Editar</button>
                    <button className="btn sm ghost" onClick={() => toggle(c)}>{c.activo ? 'Desactivar' : 'Activar'}</button>
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
