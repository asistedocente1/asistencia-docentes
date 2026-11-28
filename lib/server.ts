// Utilidades SOLO para rutas de API (servidor). Nunca importar desde componentes del navegador.
import { NextRequest, NextResponse } from 'next/server';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { Role } from './types';

export function adminClient(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SERVICE_ROLE_KEY as string, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** Identifica a quien llama usando su token y revisa que siga activo */
export async function getCaller(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const sb = adminClient();
  const { data } = await sb.auth.getUser(token);
  if (!data.user) return null;
  const { data: me } = await sb.from('profiles').select('id, role, active').eq('id', data.user.id).maybeSingle();
  if (!me || !me.active) return null;
  return { sb, me: me as { id: string; role: Role; active: boolean } };
}

export const fail = (error: string, status: number) => NextResponse.json({ error }, { status });

/** Escribe en la bitácora. Si falla, no interrumpe la operación principal. */
export async function logBitacora(
  sb: SupabaseClient,
  actor: string,
  accion: string,
  entidad: string,
  entidadId: string,
  resumen: string,
  detalle?: Record<string, unknown>
) {
  try {
    await sb.rpc('log_bitacora', {
      p_actor: actor,
      p_accion: accion,
      p_entidad: entidad,
      p_entidad_id: entidadId,
      p_resumen: resumen,
      p_detalle: detalle ?? null,
    });
  } catch {
    /* la bitácora nunca debe tumbar la operación */
  }
}
