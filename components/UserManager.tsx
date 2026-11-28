'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { ROLE_LABEL } from '@/lib/config';
import { money } from '@/lib/format';
import type { Profile, Role } from '@/lib/types';
import Modal from './Modal';

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

  // ---- edición ----
  const [editing, setEditing] = useState<Profile | null>(null);
  const [ef, setEf] = useState({ full_name: '', email: '', role: 'admin' as Role, hourly_rate: '', password: '' });
  const [editMsg, setEditMsg] = useState<Msg>(null);
  const [editSaving, setEditSaving] = useState(false);

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

  async function toggleActive(u: Profile) {
    setMsg(null);
    try {
      await api('PATCH', { id: u.id, active: !u.active });
      setMsg({ t: 'ok', m: u.active ? 'Usuario desactivado.' : 'Usuario activado.' });
      await load();
    } catch (err) {
      setMsg({ t: 'err', m: (err as Error).message });
    }
  }

  function openEdit(u: Profile) {
    setEditing(u);
    setEditMsg(null);
    setEf({
      full_name: u.full_name,
      email: u.email,
      role: u.role,
      hourly_rate: u.role === 'profesor' ? String(u.hourly_rate ?? 0) : '',
      password: '',
    });
  }

  // El rol solo lo cambia el Super administrador, en otra persona y entre roles que no son de profesor
  const rolesEditables = creatable.filter((r) => r !== 'profesor');
  const canChangeRole =
    !!editing && profile?.role === 'super_admin' && editing.id !== profile.id && editing.role !== 'profesor';

  async function onEdit(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setEditMsg(null);

    const body: Record<string, unknown> = { id: editing.id };
    if (ef.full_name.trim() !== editing.full_name) body.full_name = ef.full_name.trim();
    if (ef.email.trim().toLowerCase() !== editing.email.toLowerCase()) body.email = ef.email.trim();
    if (canChangeRole && ef.role !== editing.role) body.role = ef.role;
    if (editing.role === 'profesor' && Number(ef.hourly_rate || 0) !== Number(editing.hourly_rate)) {
      body.hourly_rate = Number(ef.hourly_rate || 0);
    }
    if (ef.password) body.password = ef.password;

    if (Object.keys(body).length === 1) {
      setEditMsg({ t: 'err', m: 'No hiciste ningún cambio.' });
      return;
    }

    setEditSaving(true);
    try {
      await api('PATCH', body);
      setEditing(null);
      setMsg({ t: 'ok', m: 'Cambios guardados.' });
      await load();
    } catch (err) {
      setEditMsg({ t: 'err', m: (err as Error).message });
    }
    setEditSaving(false);
  }

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
            <input type="email" required inputMode="email" autoCapitalize="none" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div>
            <label>Contraseña inicial</label>
            <input type="text" minLength={8} required autoCapitalize="none" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
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
              <input type="number" inputMode="decimal" min={0} step="0.01" value={form.hourly_rate} onChange={(e) => setForm({ ...form, hourly_rate: e.target.value })} />
            </div>
          )}
          <button className="btn" disabled={saving}>{saving ? 'Guardando…' : 'Crear usuario'}</button>
        </form>
      </div>

      <div className="card">
        <h2>Registrados ({rows.length})</h2>
        <div className="table-wrap">
          <table className="stack">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Correo</th>
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
                <tr key={u.id} style={{ opacity: u.active ? 1 : 0.6 }}>
                  <td data-label="Nombre"><strong>{u.full_name}</strong></td>
                  <td data-label="Correo" className="wrap-anywhere">{u.email}</td>
                  <td data-label="Rol"><span className="badge">{ROLE_LABEL[u.role]}</span></td>
                  {showRate && (
                    <td data-label="$ / hora" className="num">{u.role === 'profesor' ? money(Number(u.hourly_rate)) : '—'}</td>
                  )}
                  <td data-label="Estado"><span className={`badge ${u.active ? 'ok' : 'err'}`}>{u.active ? 'Activo' : 'Inactivo'}</span></td>
                  <td className="actions">
                    <button className="btn sm" onClick={() => openEdit(u)}>Editar</button>
                    {u.id !== profile?.id && (
                      <button className={`btn sm ${u.active ? 'danger' : 'ghost'}`} onClick={() => toggleActive(u)}>
                        {u.active ? 'Desactivar' : 'Activar'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {editing && (
        <Modal title="Editar usuario" subtitle={ROLE_LABEL[editing.role]} onClose={() => setEditing(null)} locked={editSaving}>
          <form onSubmit={onEdit} className="stack-form">
            {editMsg && <div className={`msg ${editMsg.t}`} style={{ margin: 0 }}>{editMsg.m}</div>}
            <div>
              <label>Nombre completo</label>
              <input required value={ef.full_name} onChange={(e) => setEf({ ...ef, full_name: e.target.value })} />
            </div>
            <div>
              <label>Correo (con el que inicia sesión)</label>
              <input type="email" required inputMode="email" autoCapitalize="none" value={ef.email} onChange={(e) => setEf({ ...ef, email: e.target.value })} />
            </div>
            {canChangeRole && (
              <div>
                <label>Rol</label>
                <select value={ef.role} onChange={(e) => setEf({ ...ef, role: e.target.value as Role })}>
                  {rolesEditables.map((r) => (
                    <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                  ))}
                </select>
              </div>
            )}
            {editing.role === 'profesor' && (
              <div>
                <label>Pago por hora (MXN)</label>
                <input type="number" inputMode="decimal" min={0} step="0.01" value={ef.hourly_rate} onChange={(e) => setEf({ ...ef, hourly_rate: e.target.value })} />
                <small className="hint">El cambio aplica a los reportes de todo el periodo consultado, no solo hacia adelante.</small>
              </div>
            )}
            <div>
              <label>Nueva contraseña (opcional)</label>
              <input type="password" minLength={8} autoComplete="new-password" placeholder="Déjala vacía para no cambiarla" value={ef.password} onChange={(e) => setEf({ ...ef, password: e.target.value })} />
            </div>
            <div className="modal-actions">
              <button type="button" className="btn ghost" onClick={() => setEditing(null)} disabled={editSaving}>Cancelar</button>
              <button className="btn" disabled={editSaving}>{editSaving ? 'Guardando…' : 'Guardar cambios'}</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
