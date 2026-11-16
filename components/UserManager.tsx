'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { ROLE_LABEL } from '@/lib/config';
import type { Profile, Role } from '@/lib/types';

interface Props {
  title: string;
  subtitle: string;
  filter: Role[]; // roles que se listan
  creatable: Role[]; // roles que se pueden dar de alta desde esta pantalla
}

type Msg = { t: 'ok' | 'err'; m: string } | null;

export default function UserManager({ title, subtitle, filter, creatable }: Props) {
  const { session, profile } = useAuth();
  const filterKey = filter.join(',');
  const [rows, setRows] = useState<Profile[]>([]);
  const [msg, setMsg] = useState<Msg>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    full_name: '',
    email: '',
    password: '',
    role: creatable[0] as Role,
    hourly_rate: '',
  });

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .in('role', filterKey.split(',') as Role[])
      .order('full_name');
    setRows((data as Profile[]) || []);
  }, [filterKey]);

  useEffect(() => {
    load();
  }, [load]);

  async function api(method: 'POST' | 'PATCH', body: object) {
    const r = await fetch('/api/usuarios', {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Ocurrió un error');
    return j;
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    try {
      await api('POST', { ...form, hourly_rate: Number(form.hourly_rate || 0) });
      setMsg({ t: 'ok', m: 'Usuario creado correctamente.' });
      setForm({ ...form, full_name: '', email: '', password: '', hourly_rate: '' });
      await load();
    } catch (err) {
      setMsg({ t: 'err', m: (err as Error).message });
    }
    setSaving(false);
  }

  async function patch(id: string, body: object, okMsg: string) {
    setMsg(null);
    try {
      await api('PATCH', { id, ...body });
      setMsg({ t: 'ok', m: okMsg });
      await load();
    } catch (err) {
      setMsg({ t: 'err', m: (err as Error).message });
    }
  }

  const resetPassword = (u: Profile) => {
    const p = window.prompt(`Nueva contraseña para ${u.full_name} (mínimo 8 caracteres):`);
    if (p) patch(u.id, { password: p }, 'Contraseña actualizada.');
  };

  const showRate = filter.includes('profesor');

  return (
    <>
      <h1>{title}</h1>
      <p className="sub">{subtitle}</p>

      {msg && <div className={`msg ${msg.t}`}>{msg.m}</div>}

      <div className="card">
        <h2>Dar de alta</h2>
        <form onSubmit={onCreate} className="form-grid">
          <div>
            <label>Nombre completo</label>
            <input required value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
          </div>
          <div>
            <label>Correo</label>
            <input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div>
            <label>Contraseña inicial</label>
            <input type="text" minLength={8} required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </div>
          {creatable.length > 1 && (
            <div>
              <label>Rol</label>
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
                {creatable.map((r) => (
                  <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                ))}
              </select>
            </div>
          )}
          {form.role === 'profesor' && (
            <div>
              <label>Pago por hora (MXN)</label>
              <input type="number" min={0} step="0.01" value={form.hourly_rate} onChange={(e) => setForm({ ...form, hourly_rate: e.target.value })} />
            </div>
          )}
          <button className="btn" disabled={saving}>{saving ? 'Guardando…' : 'Crear usuario'}</button>
        </form>
      </div>

      <div className="card">
        <h2>Registrados ({rows.length})</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th className="hide-sm">Correo</th>
                <th>Rol</th>
                {showRate && <th className="num">$ / hora</th>}
                <th>Estado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={6} className="empty">Aún no hay registros.</td></tr>
              )}
              {rows.map((u) => (
                <tr key={u.id}>
                  <td>{u.full_name}</td>
                  <td className="hide-sm">{u.email}</td>
                  <td><span className="badge">{ROLE_LABEL[u.role]}</span></td>
                  {showRate && (
                    <td className="num">
                      {u.role === 'profesor' ? (
                        <input
                          key={u.id + u.hourly_rate}
                          type="number"
                          min={0}
                          step="0.01"
                          defaultValue={u.hourly_rate}
                          style={{ width: 100, minHeight: 34, padding: '4px 8px', textAlign: 'right' }}
                          onBlur={(e) => {
                            const v = Number(e.target.value);
                            if (v !== Number(u.hourly_rate) && v >= 0) patch(u.id, { hourly_rate: v }, 'Pago por hora actualizado.');
                          }}
                        />
                      ) : '—'}
                    </td>
                  )}
                  <td><span className={`badge ${u.active ? 'ok' : 'err'}`}>{u.active ? 'Activo' : 'Inactivo'}</span></td>
                  <td>
                    <div className="row" style={{ justifyContent: 'flex-end' }}>
                      <button className="btn sm ghost" onClick={() => resetPassword(u)}>Contraseña</button>
                      {u.id !== profile?.id && (
                        <button
                          className={`btn sm ${u.active ? 'danger' : ''}`}
                          onClick={() => patch(u.id, { active: !u.active }, u.active ? 'Usuario desactivado.' : 'Usuario activado.')}
                        >
                          {u.active ? 'Desactivar' : 'Activar'}
                        </button>
                      )}
                    </div>
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
