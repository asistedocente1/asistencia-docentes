import { NextRequest, NextResponse } from 'next/server';
import { fail, getCaller } from '@/lib/server';
import { buildReportePdf } from '@/lib/reporte-pdf';
import { matrizQR } from '@/lib/reporte-qr';
import { fe8 } from '@/lib/reporte-sello';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const caller = await getCaller(req);
  if (!caller) return fail('No autorizado', 401);
  if (!['super_admin', 'admin', 'control_escolar'].includes(caller.me.role)) return fail('Sin permiso', 403);
  const id = req.nextUrl.searchParams.get('id') ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail('Reporte inválido', 400);
  const { sb } = caller;

  const { data: r } = await sb.from('reportes_horas').select('*').eq('id', id).maybeSingle();
  if (!r) return fail('Reporte no encontrado', 404);
  const { data: det } = await sb
    .from('reportes_horas_detalle')
    .select('fecha, materia, grupo, dia_semana, hora_inicio, hora_fin, minutos')
    .eq('reporte_id', id)
    .order('fecha');

  const origen = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') || req.nextUrl.origin;
  const url = `${origen}/verificar?id=${r.id}&fe=${encodeURIComponent(fe8(r.sello))}`;

  const pdf = await buildReportePdf({
    profesorNombre: r.profesor_nombre, folio: Number(r.folio), fechaEmision: r.fecha_emision,
    desde: r.desde, hasta: r.hasta, tarifa: Number(r.tarifa),
    sesiones: (det || []).map((x: any) => ({ ...x, dia_semana: Number(x.dia_semana), minutos: Number(x.minutos) })),
    cadena: r.cadena_original, sello: r.sello, serie: r.serie, anulado: r.estado === 'anulado', qr: matrizQR(url),
  });
  const nombre = `Reporte_horas_${String(r.folio).padStart(5, '0')}_${r.profesor_nombre.replace(/[^A-Za-z0-9]+/g, '_')}.pdf`;
  return new NextResponse(Buffer.from(pdf), {
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${nombre}"` },
  });
}
