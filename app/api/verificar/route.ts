import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/server';
import { cadenaOriginal, fe8, verificar } from '@/lib/reporte-sello';

export const runtime = 'nodejs';

/** Verificación pública (sin sesión): se llega escaneando el QR del reporte */
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id') ?? '';
  const fe = req.nextUrl.searchParams.get('fe') ?? '';
  const noEncontrado = () => NextResponse.json({ encontrado: false }, { status: 404 });
  if (!/^[0-9a-f-]{36}$/i.test(id) || fe.length !== 8) return noEncontrado();

  const sb = adminClient();
  const { data: r } = await sb.from('reportes_horas').select('*').eq('id', id).maybeSingle();
  if (!r || fe8(r.sello) !== fe) return noEncontrado();
  const { data: det } = await sb
    .from('reportes_horas_detalle').select('asistencia_id, fecha, minutos').eq('reporte_id', id);

  const cadena = cadenaOriginal({
    folio: Number(r.folio), id: r.id, fecha_emision: new Date(r.fecha_emision).toISOString(), profesor_id: r.profesor_id,
    profesor_nombre: r.profesor_nombre, desde: r.desde, hasta: r.hasta, total_minutos: r.total_minutos,
    tarifa: Number(r.tarifa), monto: Number(r.monto), num_sesiones: r.num_sesiones,
    detalle: (det || []).map((x: any) => ({ asistencia_id: x.asistencia_id, fecha: x.fecha, minutos: Number(x.minutos) })),
  });
  const integra = cadena === r.cadena_original;
  const firmaValida = integra && verificar(cadena, r.sello);
  return NextResponse.json({
    encontrado: true, autentico: firmaValida, estado: r.estado, anulado_at: r.anulado_at,
    folio: Number(r.folio), profesor: r.profesor_nombre, desde: r.desde, hasta: r.hasta,
    horas: r.total_minutos / 60, monto: Number(r.monto), sesiones: r.num_sesiones,
    fecha_emision: r.fecha_emision, serie: r.serie,
  });
}
