'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { defaultPath } from '@/lib/config';

export default function Home() {
  const { session, profile, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!session) router.replace('/login');
    else if (profile) router.replace(defaultPath(profile.role));
    else router.replace('/dashboard'); // el layout mostrará el aviso de "sin perfil"
  }, [loading, session, profile, router]);

  return <div className="center">Cargando…</div>;
}
