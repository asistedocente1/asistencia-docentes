'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { DIAS, PLANTELES } from '@/lib/config';
import { hhmm } from '@/lib/format';
import type { Clase, Profile } from '@/lib/types';

export default function ClasesPage() {
  const [profes, setProfes] = useState<Profile[]>([]);
  const [clases, setClases] = useState<Clase[]>([]);
  const [filtro, setFiltro] = useState('');
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; m: string } | null>(null);
  const [form, setForm] = useState({
    profesor_id: '',
    materia: '',
    grupo: '',
    plantel: PLANTELES[0],
    dia_semana: 1,
    hora_inicio: '08:00',
    hora_fin: '10:00',
  });

  const load = useCallback(async () => {
    const [p, c] = await Promise.all([
      supabase.from('profiles').select('*').eq('role', 'profesor').eq('active', true).order('full_name'),
      supabase.from('clases').select('*, profiles(full_name)').order('dia_semana').order('hora_inicio'),
    ]);
    setProfes((p.data as Profile[]) || []);
    setClases((c.data as Clase[]) || []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!form.profesor_id) return setMsg({ t: 'err', m: 'Selecciona un profesor.' });
    if (form.hora_fin <= form.hora_inicio) return setMsg({ t: 'err', m: 'La hora de fin debe ser posterior a la de inicio.' });
    const { error } = await supabase.from('clases').insert({ ...form, dia_semana: Number(form.dia_semana) });
    if (error) return setMsg({ t: 'err', m: error.message });
    setMsg({ t: 'ok', m: 'Clase agregada.' });
    setForm({ ...form, materia: '', grupo: '' });
    load();
  }

  async function toggle(c: Clase) {
    const { error } = await supabase.from('clases').update({ activo: !c.activo }).eq('id', c.id);
    if (error) setMsg({ t: 'err', m: error.message });
    load();
  }

  const lista = clases.filter((c) => !filtro || c.profesor_id === filtro);

  return (
    <>
      <h1>Clases y horarios</h1>
      <p className="sub">El profesor solo verá y podrá registrar las clases que le asignes aquí, el día que le toquen.</p>

      {msg && <div className={`msg ${msg.t}`}>{msg.m}</div>}

      <div className="card">
        <h2>Nueva clase</h2>
        <form onSubmit={onSubmit} className="form-grid">
          <div>
            <label>Profesor</label>
            <select required value={form.profesor_id} onChange={(e) => setForm({ ...form, profesor_id: e.target.value })}>
              <option value="">Selecciona…</option>
              {profes.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
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
              {PLANTELES.map((p) => <option key={p}>{p}</option>)}
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
          <button className="btn">Agregar clase</button>
        </form>
      </div>

      <div className="card">
        <div className="row between" style={{ marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>Horarios ({lista.length})</h2>
          <select value={filtro} onChange={(e) => setFiltro(e.target.value)} style={{ maxWidth: 260 }}>
            <option value="">Todos los profesores</option>
            {profes.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </select>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Profesor</th>
                <th>Materia</th>
                <th className="hide-sm">Grupo</th>
                <th className="hide-sm">Plantel</th>
                <th>Día</th>
                <th>Horario</th>
                <th>Estado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {lista.length === 0 && <tr><td colSpan={8} className="empty">No hay clases registradas.</td></tr>}
              {lista.map((c) => (
                <tr key={c.id} style={{ opacity: c.activo ? 1 : 0.55 }}>
                  <td>{c.profiles?.full_name}</td>
                  <td>{c.materia}</td>
                  <td className="hide-sm">{c.grupo}</td>
                  <td className="hide-sm">{c.plantel}</td>
                  <td>{DIAS[c.dia_semana]}</td>
                  <td>{hhmm(c.hora_inicio)} – {hhmm(c.hora_fin)}</td>
                  <td><span className={`badge ${c.activo ? 'ok' : 'err'}`}>{c.activo ? 'Activa' : 'Inactiva'}</span></td>
                  <td><button className="btn sm ghost" onClick={() => toggle(c)}>{c.activo ? 'Desactivar' : 'Activar'}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
