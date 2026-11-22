import { NextRequest, NextResponse } from 'next/server';
import { adminClient, fail, getCaller, logBitacora } from '@/lib/server';
import { ROLE_LABEL } from '@/lib/config';
import type { Role } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROLES: Role[] = ['super_admin', 'admin', 'profesor', 'control_escolar', 'apertura'];
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** super_admin gestiona a todos; admin solo gestiona profesores */
function canManage(callerRole: Role, targetRole: Role) {
  if (callerRole === 'super_admin') return true;
  if (callerRole === 'admin') return targetRole === 'profesor';
  return false;
}

const isDup = (msg?: string) => /already|registered|exists|duplicate/i.test(msg || '');

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

  if (!EMAIL_RE.test(email)) return fail('Correo inválido', 400);
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
    return fail(isDup(e1?.message) ? 'Ya existe un usuario con ese correo' : e1?.message || 'No se pudo crear el usuario', 400);
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

  await logBitacora(ctx.sb, ctx.me.id, 'usuario.crear', 'usuario', created.user.id,
    `Creó al usuario ${full_name} (${ROLE_LABEL[role]}) con correo ${email}`,
    { rol: ROLE_LABEL[role], ...(role === 'profesor' ? { pago_por_hora: hourly_rate } : {}) });

  return NextResponse.json({ ok: true, id: created.user.id });
}

export async function PATCH(req: NextRequest) {
  const ctx = await getCaller(req);
  if (!ctx) return fail('No autorizado', 401);

  const body = await req.json().catch(() => null);
  if (!body?.id) return fail('Solicitud inválida', 400);

  const { data: target } = await ctx.sb
    .from('profiles')
    .select('id, role, active, email, full_name, hourly_rate')
    .eq('id', body.id)
    .maybeSingle();
  if (!target) return fail('Usuario no encontrado', 404);
  if (!canManage(ctx.me.role, target.role as Role)) return fail('No tienes permiso sobre este usuario', 403);

  const isSelf = target.id === ctx.me.id;
  const patch: Record<string, unknown> = {};
  const cambios: Record<string, unknown> = {};
  const authAttrs: { email?: string; email_confirm?: boolean; password?: string } = {};

  // ---- Nombre ----
  if (body.full_name !== undefined) {
    const v = String(body.full_name).trim();
    if (!v) return fail('El nombre no puede quedar vacío', 400);
    if (v !== target.full_name) {
      patch.full_name = v;
      cambios.nombre = { antes: target.full_name, despues: v };
    }
  }

  // ---- Correo ----
  if (body.email !== undefined) {
    const v = String(body.email).trim().toLowerCase();
    if (!EMAIL_RE.test(v)) return fail('Correo inválido', 400);
    if (v !== String(target.email).toLowerCase()) {
      patch.email = v;
      authAttrs.email = v;
      authAttrs.email_confirm = true;
      cambios.correo = { antes: target.email, despues: v };
    }
  }

  // ---- Rol (solo el super administrador, y nunca el propio) ----
  if (body.role !== undefined && body.role !== target.role) {
    if (ctx.me.role !== 'super_admin') return fail('Solo el Super administrador puede cambiar roles', 403);
    if (!ROLES.includes(body.role)) return fail('Rol inválido', 400);
    if (isSelf) return fail('No puedes cambiar tu propio rol', 400);
    if (target.role === 'profesor' || body.role === 'profesor') {
      return fail('Los profesores no cambian de rol desde aquí; da de alta un usuario nuevo', 400);
    }
    if (target.role === 'super_admin') {
      const { count } = await ctx.sb
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('role', 'super_admin')
        .eq('active', true)
        .neq('id', target.id);
      if ((count ?? 0) < 1) return fail('Debe existir al menos un Super administrador activo', 400);
    }
    patch.role = body.role;
    cambios.rol = { antes: ROLE_LABEL[target.role as Role], despues: ROLE_LABEL[body.role as Role] };
  }
  const finalRole = (patch.role as Role | undefined) ?? (target.role as Role);

  // ---- Pago por hora (solo profesores) ----
  if (body.hourly_rate !== undefined && finalRole === 'profesor') {
    const r = Number(body.hourly_rate);
    if (!(r >= 0)) return fail('Pago por hora inválido', 400);
    if (r !== Number(target.hourly_rate)) {
      patch.hourly_rate = r;
      cambios.pago_por_hora = { antes: Number(target.hourly_rate), despues: r };
    }
  }

  // ---- Activar / desactivar ----
  let soloEstado = false;
  if (typeof body.active === 'boolean' && body.active !== target.active) {
    if (isSelf && body.active === false) return fail('No puedes desactivar tu propio usuario', 400);
    patch.active = body.active;
    cambios.estado = { antes: target.active ? 'Activo' : 'Inactivo', despues: body.active ? 'Activo' : 'Inactivo' };
  }

  // ---- Contraseña (nunca se guarda en la bitácora) ----
  if (typeof body.password === 'string' && body.password) {
    if (body.password.length < 8) return fail('La contraseña debe tener al menos 8 caracteres', 400);
    authAttrs.password = body.password;
    cambios.contrasena = 'restablecida';
  }

  if (Object.keys(cambios).length === 0) return NextResponse.json({ ok: true, sin_cambios: true });
  soloEstado = Object.keys(cambios).length === 1 && 'estado' in cambios;

  // 1) Cuenta de acceso (correo y/o contraseña)
  if (Object.keys(authAttrs).length) {
    const { error } = await ctx.sb.auth.admin.updateUserById(target.id, authAttrs);
    if (error) return fail(isDup(error.message) ? 'Ya existe un usuario con ese correo' : error.message, 400);
  }

  // 2) Perfil
  if (Object.keys(patch).length) {
    const { error } = await ctx.sb.from('profiles').update(patch).eq('id', target.id);
    if (error) {
      if (authAttrs.email) {
        await ctx.sb.auth.admin.updateUserById(target.id, { email: target.email, email_confirm: true }); // revierte
      }
      return fail('No se pudo guardar: ' + error.message, 500);
    }
  }

  const nombre = (patch.full_name as string | undefined) ?? target.full_name;
  if (soloEstado) {
    await logBitacora(ctx.sb, ctx.me.id,
      patch.active ? 'usuario.activar' : 'usuario.desactivar', 'usuario', target.id,
      `${patch.active ? 'Activó' : 'Desactivó'} al usuario ${nombre}`, cambios);
  } else {
    await logBitacora(ctx.sb, ctx.me.id, 'usuario.editar', 'usuario', target.id,
      `Editó al usuario ${nombre}: ${Object.keys(cambios).join(', ')}`, cambios);
  }

  return NextResponse.json({ ok: true });
}
