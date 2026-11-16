'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import Logo from '@/components/Logo';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) {
      setError('Correo o contraseña incorrectos.');
      setBusy(false);
      return;
    }
    router.replace('/');
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <Logo />
        <h1>Asistencia docente</h1>
        <p className="sub">Ingresa con tu correo institucional</p>
        <form onSubmit={onSubmit}>
          {error && <div className="msg err" style={{ margin: 0 }}>{error}</div>}
          <div>
            <label htmlFor="email">Correo</label>
            <input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <label htmlFor="password">Contraseña</label>
            <input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <button className="btn big" disabled={busy}>{busy ? 'Ingresando…' : 'Ingresar'}</button>
        </form>
      </div>
    </div>
  );
}
