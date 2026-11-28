// Lectura de reportes emitidos y armado de su PDF / verificación. SOLO servidor.
import type { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { construirCadena, verificarSello } from './reporte-sello';
import type { SesionReporte } from './reporte-calc';

export type ReporteDB = {
  id: string; folio: number; profesor_id: string; profesor_nombre: string; desde: string; hasta: string;
  tarifa: number; total_minutos: number; monto: number; num_sesiones: number; fecha_emision: string;
  cadena_original: string; sello: string; serie: string; estado: 'vigente' | 'anulado';
  anulado_at: string | null; anulado_motivo: string | null;
};

export const origenDe = (req: NextRequest) => {
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || new URL(req.url).host;
  const proto = req.headers.get('x-forwarded-proto') || (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
};

export const urlVerificacion = (req: NextRequest, id: string, sello: string) =>
  `${origenDe(req)}/verificar?id=${id}&fe=${sello.slice(-8)}`;

export async function cargarReporte(sb: SupabaseClient, id: string) {
  const { data: r } = await sb.from('reportes_horas').select('*').eq('id', id).maybeSingle();
  if (!r) return null;
  const { data: det } = await sb
    .from('reportes_horas_detalle')
    .select('asistencia_id, clase_id, fecha, materia, grupo, plantel, dia_semana, hora_inicio, hora_fin, minutos')
    .eq('reporte_id', id)
    .order('fecha');
  const sesiones = ((det || []) as SesionReporte[]).map((s) => ({ ...s, minutos: Number(s.minutos), dia_semana: Number(s.dia_semana) }));
  return { reporte: { ...r, tarifa: Number(r.tarifa), monto: Number(r.monto) } as ReporteDB, sesiones };
}

/** Recalcula la cadena con lo guardado y revisa que coincida y que el sello sea auténtico */
export function comprobarIntegridad(r: ReporteDB, ses: SesionReporte[]) {
  const cadena = construirCadena(
    {
      folio: r.folio, id: r.id, fecha_emision: new Date(r.fecha_emision).toISOString(), profesor_id: r.profesor_id,
      profesor_nombre: r.profesor_nombre, desde: r.desde, hasta: r.hasta, total_minutos: r.total_minutos,
      tarifa: r.tarifa, monto: r.monto, num_sesiones: r.num_sesiones,
    },
    ses
  );
  return cadena === r.cadena_original && verificarSello(r.cadena_original, r.sello);
}
