'use client';

import { ReactNode, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { navFor } from '@/lib/nav';
import { ROLE_LABEL, defaultPath } from '@/lib/config';
import Icon from '@/components/Icon';
import Logo from '@/components/Logo';

export default function AppLayout({ children }: { children: ReactNode }) {
  const { session, profile, loading, signOut } = useAuth();
  const router = useRouter();
  const path = usePathname();
  const [open, setOpen] = useState(false);

  const items = profile ? navFor(profile.role) : [];

  useEffect(() => {
    if (!loading && !session) router.replace('/login');
  }, [loading, session, router]);

  // Cierra el menú al cambiar de página
  useEffect(() => setOpen(false), [path]);

  // Con el menú abierto en celular/tablet, la página de atrás no se desplaza
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Si el rol no tiene acceso a esta ruta, lo manda a su inicio
  useEffect(() => {
    if (profile && profile.active && !items.some((i) => path.startsWith(i.href))) {
      router.replace(defaultPath(profile.role));
    }
  }, [profile, path, items, router]);

  if (loading || !session) return <div className="center">Cargando…</div>;

  if (!profile || !profile.active) {
    return (
      <div className="center">
        <Logo className="" />
        <h2>{profile ? 'Usuario desactivado' : 'Tu usuario aún no tiene un perfil asignado'}</h2>
        <p className="sub">Comunícate con el área de sistemas.</p>
        <button className="btn" onClick={signOut}>Cerrar sesión</button>
      </div>
    );
  }

  return (
    <div className="shell">
      <div className={`overlay ${open ? 'open' : ''}`} onClick={() => setOpen(false)} />

      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="sidebar-head">
          <Logo />
          <button className="sidebar-close" onClick={() => setOpen(false)} aria-label="Cerrar menú">
            <Icon name="x" />
          </button>
        </div>
        <nav className="nav">
          {items.map((i) => (
            <Link key={i.href} href={i.href} className={path.startsWith(i.href) ? 'active' : ''}>
              <Icon name={i.icon} />
              {i.label}
            </Link>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="who">{profile.full_name}</div>
          <div className="role">{ROLE_LABEL[profile.role]}</div>
          <button className="logout" onClick={signOut}>
            <Icon name="logout" size={18} /> Cerrar sesión
          </button>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <button className="menu-btn" onClick={() => setOpen(true)} aria-label="Abrir menú">
            <Icon name="menu" size={26} />
          </button>
          <Logo />
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
