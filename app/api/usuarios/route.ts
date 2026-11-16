import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROLES = ['super_admin', 'admin', 'profesor', 'control_escolar'] as const;
type Role = (typeof ROLES)[number];

function adminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SERVICE_ROLE_KEY as string, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** Identifica a quien llama usando su token y revisa que siga activo */
async function getCaller(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const sb = adminClient();
  const { data } = await sb.auth.getUser(token);
  if (!data.user) return null;
  const { data: me } = await sb.from('profiles').select('id, role, active').eq('id', data.user.id).maybeSingle();
  if (!me || !me.active) return null;
  return { sb, me: me as { id: string; role: Role; active: boolean } };
}

/** super_admin gestiona a todos; admin solo gestiona profesores */
function canManage(callerRole: Role, targetRole: Role) {
  if (callerRole === 'super_admin') return true;
  if (callerRole === 'admin') return targetRole === 'profesor';
  return false;
}

const fail = (error: string, status: number) => NextResponse.json({ error }, { status });

export async function POST(req: NextRequest) {
  const ctx = await getCaller(req);
  if (!ctx) return fail('No autorizado', 401);

  const body = await req.json().catch(() => null);
  if (!body) return fail('Solicitud inválida', 400);

  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const full_name = String(body.full_name || '').trim();
  const role = body.role as Role;
  const hourly_rate = Number(body.hourly_rate || 0);

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail('Correo inválido', 400);
  if (password.length < 8) return fail('La contraseña debe tener al menos 8 caracteres', 400);
  if (!full_name) return fail('El nombre es obligatorio', 400);
  if (!ROLES.includes(role)) return fail('Rol inválido', 400);
  if (!(hourly_rate >= 0)) return fail('Pago por hora inválido', 400);
  if (!canManage(ctx.me.role, role)) return fail('No tienes permiso para crear ese rol', 403);

  const { data: created, error: e1 } = await ctx.sb.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (e1 || !created.user) {
    const dup = /already|registered|exists/i.test(e1?.message || '');
    return fail(dup ? 'Ya existe un usuario con ese correo' : e1?.message || 'No se pudo crear el usuario', 400);
  }

  const { error: e2 } = await ctx.sb.from('profiles').insert({
    id: created.user.id,
    email,
    full_name,
    role,
    hourly_rate: role === 'profesor' ? hourly_rate : 0,
  });
  if (e2) {
    await ctx.sb.auth.admin.deleteUser(created.user.id); // no deja usuarios a medias
    return fail('No se pudo guardar el perfil: ' + e2.message, 500);
  }

  return NextResponse.json({ ok: true, id: created.user.id });
}

export async function PATCH(req: NextRequest) {
  const ctx = await getCaller(req);
  if (!ctx) return fail('No autorizado', 401);

  const body = await req.json().catch(() => null);
  if (!body?.id) return fail('Solicitud inválida', 400);

  const { data: target } = await ctx.sb.from('profiles').select('id, role').eq('id', body.id).maybeSingle();
  if (!target) return fail('Usuario no encontrado', 404);
  if (!canManage(ctx.me.role, target.role as Role)) return fail('No tienes permiso sobre este usuario', 403);

  const patch: Record<string, unknown> = {};
  if (typeof body.active === 'boolean') {
    if (target.id === ctx.me.id && body.active === false) return fail('No puedes desactivar tu propio usuario', 400);
    patch.active = body.active;
  }
  if (body.hourly_rate !== undefined) {
    const r = Number(body.hourly_rate);
    if (!(r >= 0)) return fail('Pago por hora inválido', 400);
    patch.hourly_rate = r;
  }
  if (typeof body.full_name === 'string' && body.full_name.trim()) patch.full_name = body.full_name.trim();

  if (Object.keys(patch).length) {
    const { error } = await ctx.sb.from('profiles').update(patch).eq('id', target.id);
    if (error) return fail(error.message, 500);
  }

  if (typeof body.password === 'string' && body.password) {
    if (body.password.length < 8) return fail('La contraseña debe tener al menos 8 caracteres', 400);
    const { error } = await ctx.sb.auth.admin.updateUserById(target.id, { password: body.password });
    if (error) return fail(error.message, 500);
  }

  return NextResponse.json({ ok: true });
}
