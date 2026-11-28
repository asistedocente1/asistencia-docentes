import { NextRequest, NextResponse } from 'next/server';
import { fail, getCaller } from '@/lib/server';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const caller = await getCaller(req);
  if (!caller) return fail('No autorizado', 401);
  if (!['super_admin', 'admin'].includes(caller.me.role)) return fail('Sin permiso para anular reportes', 403);
  const body = await req.json().catch(() => null);
  const id = String(body?.id ?? '');
  const motivo = String(body?.motivo ?? '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail('Reporte inválido', 400);
  if (motivo.length < 5) return fail('Escribe el motivo de la anulación (mínimo 5 caracteres)', 400);
  const { error } = await caller.sb.rpc('_reporte_anular', { p_id: id, p_actor: caller.me.id, p_motivo: motivo });
  if (error) return fail(error.message, 400);
  return NextResponse.json({ ok: true });
}
