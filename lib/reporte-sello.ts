// Sello electrónico y cadena original de los reportes de horas.
// Es un sello INTERNO (RSA-SHA256), parecido en estructura al de un CFDI, pero NO es un timbre del SAT.
import { createHash, createPublicKey, createPrivateKey, createSign, createVerify } from 'node:crypto';

export type DetalleSello = { asistencia_id: string; fecha: string; minutos: number };

export type FaltaSello = { clase_id: string; fecha: string };

export type DatosCadena = {
  folio: number;
  id: string;
  fecha_emision: string; // ISO UTC
  profesor_id: string;
  profesor_nombre: string;
  desde: string;
  hasta: string;
  total_minutos: number;
  tarifa: number;
  monto: number;
  num_sesiones: number;
  num_faltas: number;
  minutos_descontados: number;
  detalle: DetalleSello[];
  faltas: FaltaSello[];
};

const limpia = (s: string) => String(s).replace(/\|/g, ' ').replace(/\s+/g, ' ').trim();
const d2 = (n: number) => Number(n).toFixed(2);

export function hashDetalle(detalle: DetalleSello[], faltas: FaltaSello[] = []): string {
  const ses = [...detalle]
    .sort((a, b) => (a.asistencia_id < b.asistencia_id ? -1 : a.asistencia_id > b.asistencia_id ? 1 : 0))
    .map((x) => `${x.asistencia_id}|${x.fecha}|${x.minutos}`);
  const fal = [...faltas]
    .map((x) => `F|${x.clase_id}|${x.fecha}`)
    .sort();
  const lineas = [...ses, ...fal].join('\n');
  return createHash('sha256').update(lineas, 'utf8').digest('hex');
}

export function cadenaOriginal(d: DatosCadena): string {
  return (
    '||1.0|' +
    [
      d.folio,
      d.id,
      d.fecha_emision,
      d.profesor_id,
      limpia(d.profesor_nombre),
      d.desde,
      d.hasta,
      d.total_minutos,
      d2(d.tarifa),
      d2(d.monto),
      d.num_sesiones,
      d.num_faltas,
      d.minutos_descontados,
      hashDetalle(d.detalle, d.faltas),
    ].join('|') +
    '||'
  );
}

/** Acepta PEM directo, PEM con \n literales, o PEM en base64 */
export function leerLlave(raw: string | undefined): string {
  if (!raw) throw new Error('Falta la variable REPORTE_PRIVATE_KEY');
  let t = raw.trim().replace(/\\n/g, '\n');
  if (!t.includes('BEGIN')) t = Buffer.from(t, 'base64').toString('utf8');
  if (!t.includes('BEGIN')) throw new Error('REPORTE_PRIVATE_KEY no es una llave PEM válida');
  return t;
}

export function firmar(cadena: string, pemRaw?: string): { sello: string; serie: string } {
  const pem = leerLlave(pemRaw ?? process.env.REPORTE_PRIVATE_KEY);
  const sello = createSign('RSA-SHA256').update(cadena, 'utf8').sign(pem).toString('base64');
  return { sello, serie: serieDe(pem) };
}

export function serieDe(pem: string): string {
  const pub = createPublicKey(createPrivateKey(pem)).export({ type: 'spki', format: 'der' });
  return createHash('sha1').update(pub).digest('hex').slice(0, 20).toUpperCase();
}

export function verificar(cadena: string, sello: string, pemRaw?: string): boolean {
  try {
    const pem = leerLlave(pemRaw ?? process.env.REPORTE_PRIVATE_KEY);
    const pub = createPublicKey(createPrivateKey(pem));
    return createVerify('RSA-SHA256').update(cadena, 'utf8').verify(pub, Buffer.from(sello, 'base64'));
  } catch {
    return false;
  }
}

/** Últimos 8 caracteres del sello, como en el QR del CFDI (fe=) */
export const fe8 = (sello: string) => sello.slice(-8);
