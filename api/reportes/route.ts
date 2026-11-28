import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { fail, getCaller } from '@/lib/server';
import { cadenaOriginal, firmar } from '@/lib/reporte-sello';

export const runtime = 'nodejs';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const MAX_CLASES = 7;

type Cand = {
  asistencia_id: string; clase_id: string; fecha: string; materia: string; grupo: string; plantel: string;
  dia_semana: number; hora_inicio: string; hora_fin: string; minutos: number;
  retardo_min: number; descuento_min: number; es_reposicion: boolean; reposicion_de: string | null;
};
type Falta = {
  clase_id: string; fecha: string; materia: string; grupo: string; hora_inicio: string; hora_fin: string;
  repuesta_fecha: string | null;
};

/** Emite un reporte de horas de UN profesor con las clases elegidas */
export async function POST(req: NextRequest) {
  const caller = await getCaller(req);
  if (!caller) return fail('No autorizado', 401);
  if (!['super_admin', 'admin'].includes(caller.me.role)) return fail('Sin permiso para emitir reportes', 403);
  const { sb, me } = caller;

  const body = await req.json().catch(() => null);
  const profesorId = String(body?.profesor_id ?? '');
  const desde = String(body?.desde ?? '');
  const hasta = String(body?.hasta ?? '');
  const clases: string[] = Array.isArray(body?.clase_ids) ? [...new Set<string>(body.clase_ids.map(String))] : [];
  if (!UUID.test(profesorId) || !FECHA.test(desde) || !FECHA.test(hasta) || hasta < desde) return fail('Datos inválidos', 400);
  if (desde.slice(0, 7) !== hasta.slice(0, 7)) return fail('El reporte debe corresponder a un solo mes (el formato de pago es mensual).', 400);
  if (clases.length === 0) return fail('Selecciona al menos una clase', 400);
  if (clases.length > MAX_CLASES) return fail(`El formato admite máximo ${MAX_CLASES} clases por reporte`, 400);
  if (!clases.every((c) => UUID.test(c))) return fail('Clases inválidas', 400);

  const { data: prof } = await sb.from('profiles').select('id, full_name, role, hourly_rate, active').eq('id', profesorId).maybeSingle();
  if (!prof || prof.role !== 'profesor') return fail('Profesor no encontrado', 404);
  const tarifa = Number(prof.hourly_rate);
  if (!(tarifa > 0)) return fail('El profesor no tiene pago por hora configurado (edítalo en Profesores)', 400);

  const { data: cands, error: e1 } = await sb.rpc('_reporte_candidatas', {
    p_profesor: profesorId, p_desde: desde, p_hasta: hasta, p_clases: clases,
  });
  if (e1) return fail(e1.message, 500);
  const det = ((cands as Cand[]) || [])
    .map((c) => ({ ...c, minutos: Number(c.minutos), retardo_min: Number(c.retardo_min), descuento_min: Number(c.descuento_min) }))
    .filter((c) => c.minutos > 0);
  if (det.length === 0) return fail('Las clases elegidas no tienen horas pendientes en ese periodo (sin salida o ya reportadas).', 400);

  const { data: fal, error: eF } = await sb.rpc('_reporte_faltas', {
    p_profesor: profesorId, p_desde: desde, p_hasta: hasta, p_clases: clases,
  });
  if (eF) return fail(eF.message, 500);
  const faltas = (fal as Falta[]) || [];
  const totalDesc = det.reduce((a, c) => a + c.descuento_min, 0);

  const totalMin = det.reduce((a, c) => a + c.minutos, 0);
  const porClase = new Map<string, number>();
  det.forEach((c) => porClase.set(c.clase_id, (porClase.get(c.clase_id) || 0) + c.minutos));
  const monto = [...porClase.values()].reduce((a, m) => a + Math.round((m / 60) * tarifa * 100) / 100, 0);
  const montoR = Math.round(monto * 100) / 100;

  const { data: folio, error: e2 } = await sb.rpc('_reporte_siguiente_folio');
  if (e2) return fail(e2.message, 500);

  const id = randomUUID();
  const fecha_emision = new Date().toISOString();
  const datos = {
    folio: Number(folio), id, fecha_emision, profesor_id: profesorId, profesor_nombre: prof.full_name as string,
    desde, hasta, total_minutos: totalMin, tarifa, monto: montoR, num_sesiones: det.length, num_faltas: faltas.length, minutos_descontados: totalDesc,
    detalle: det.map((c) => ({ asistencia_id: c.asistencia_id, fecha: c.fecha, minutos: c.minutos })),
    faltas: faltas.map((f) => ({ clase_id: f.clase_id, fecha: f.fecha })),
  };
  const cadena = cadenaOriginal(datos);
  let firma;
  try {
    firma = firmar(cadena);
  } catch (e) {
    return fail('Falta configurar la llave de firma (REPORTE_PRIVATE_KEY) en Vercel. Revisa el README.', 500);
  }

  const { error: e3 } = await sb.rpc('_reporte_guardar', {
    p: {
      id,
      reporte: {
        folio: datos.folio, profesor_id: profesorId, profesor_nombre: datos.profesor_nombre, desde, hasta, tarifa,
        total_minutos: totalMin, monto: montoR, num_sesiones: det.length, fecha_emision,
        cadena_original: cadena, sello: firma.sello, serie: firma.serie,
        num_faltas: faltas.length, minutos_descontados: totalDesc,
      },
      detalle: det,
      faltas,
    },
    p_actor: me.id,
  });
  if (e3) return fail(e3.message, 409);
  return NextResponse.json({ id, folio: datos.folio });
}
