import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { fail, getCaller, logBitacora } from '@/lib/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED = ['super_admin', 'admin', 'apertura'];
const MAX_FALLOS = 5; // intentos fallidos permitidos por profesor...
const VENTANA_MIN = 15; // ...dentro de esta ventana de minutos

/**
 * Apertura / cierre de una clase EN LÍNEA.
 * Quien opera el módulo teclea la contraseña del profesor; aquí se verifica en el servidor
 * y solo entonces se registra la asistencia. Las presenciales no pasan por aquí.
 */
export async function POST(req: NextRequest) {
  const ctx = await getCaller(req);
  if (!ctx) return fail('No autorizado', 401);
  if (!ALLOWED.includes(ctx.me.role)) return fail('No tienes permiso para abrir clases', 403);

  const body = await req.json().catch(() => null);
  const claseId = String(body?.clase_id || '');
  const accion = body?.accion;
  const password = typeof body?.password === 'string' ? body.password : '';
  const repoDe = typeof body?.repo_de === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.repo_de) ? body.repo_de : null;
  if (!claseId || (accion !== 'abrir' && accion !== 'cerrar')) return fail('Solicitud inválida', 400);
  if (!password) return fail('Escribe la contraseña del profesor', 400);

  const { data: clase } = await ctx.sb
    .from('clases')
    .select('id, materia, grupo, modalidad, activo, profesor_id')
    .eq('id', claseId)
    .maybeSingle();
  if (!clase || !clase.activo) return fail('Clase no encontrada', 404);
  if (clase.modalidad !== 'en_linea') return fail('Esta clase es presencial: se abre directamente, sin contraseña', 400);

  const { data: prof } = await ctx.sb
    .from('profiles')
    .select('id, email, full_name, active')
    .eq('id', clase.profesor_id)
    .maybeSingle();
  if (!prof || !prof.active) return fail('El profesor no está activo en el sistema', 400);

  // Límite de intentos fallidos (evita adivinar contraseñas desde este módulo)
  const desde = new Date(Date.now() - VENTANA_MIN * 60_000).toISOString();
  const { count } = await ctx.sb
    .from('bitacora')
    .select('id', { count: 'exact', head: true })
    .eq('accion', 'apertura.password_fallida')
    .eq('entidad_id', prof.id)
    .gte('created_at', desde);
  if ((count ?? 0) >= MAX_FALLOS) {
    return fail('Demasiados intentos fallidos. Espera unos minutos e inténtalo de nuevo.', 429);
  }

  // Verifica la contraseña con la misma cuenta con la que el profesor fue dado de alta
  const verificador = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  const { data: login, error: loginError } = await verificador.auth.signInWithPassword({
    email: prof.email,
    password,
  });
  if (loginError || login.user?.id !== prof.id) {
    await logBitacora(ctx.sb, ctx.me.id, 'apertura.password_fallida', 'profesor', prof.id,
      `Contraseña incorrecta de ${prof.full_name} al ${accion === 'abrir' ? 'abrir' : 'cerrar'} la clase ${clase.materia} (${clase.grupo})`,
      { clase_id: clase.id });
    return fail('Contraseña incorrecta', 401);
  }

  // Cierra la sesión que se creó solo para verificar (solo esa; no toca las demás del profesor)
  try {
    if (login.session) await ctx.sb.auth.admin.signOut(login.session.access_token, 'local');
  } catch {
    /* no es crítico */
  }

  const { data, error } = await ctx.sb.rpc(accion === 'abrir' ? '_abrir_clase' : '_cerrar_clase', {
    p_clase_id: clase.id,
    p_actor: ctx.me.id,
    p_metodo: 'en línea (contraseña verificada)',
    p_repo_de: repoDe,
  });
  if (error) return fail(error.message, 400);

  return NextResponse.json({ ok: true, asistencia_id: data });
}
