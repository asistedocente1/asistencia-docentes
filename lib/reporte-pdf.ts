// Genera el PDF del reporte de horas (carta horizontal) con el formato vigente de CUEJ,
// más QR, sello digital y cadena original. Se dibuja en vector con pdf-lib.
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from 'pdf-lib';
import { BANNER_JPG_BASE64 } from './reporte-banner';

export type SesionPdf = {
  fecha: string; // YYYY-MM-DD
  materia: string;
  grupo: string;
  dia_semana: number; // 1=lunes ... 7=domingo
  hora_inicio: string; // HH:MM[:SS]
  hora_fin: string;
  minutos: number;
  retardo_min?: number;
  descuento_min?: number; // minutos descontados por retardo (solo si excede la tolerancia)
  es_reposicion?: boolean;
  reposicion_de?: string | null;
};

export type FaltaPdf = { fecha: string; materia: string; grupo: string; repuesta_fecha?: string | null };

export type DatosPdf = {
  profesorNombre: string;
  folio: number;
  fechaEmision: string; // ISO
  desde: string;
  hasta: string;
  tarifa: number;
  sesiones: SesionPdf[];
  cadena: string;
  sello: string;
  serie: string;
  faltas?: FaltaPdf[];
  anulado?: boolean;
  qr: boolean[][]; // matriz de módulos (true = negro)
};

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const H = 612;
const hex = (h: string) => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
const C = {
  morado: hex('#481347'),
  banda: hex('#6d1d6b'),
  azul: hex('#9bb5ea'),
  rosa: hex('#fcd8f5'),
  rosaH: hex('#f1cbf0'),
  lila: hex('#a39dd5'),
  gris: hex('#f2f2f2'),
  gris2: hex('#404040'),
  negro: rgb(0, 0, 0),
  blanco: rgb(1, 1, 1),
  rojo: hex('#ff0000'),
};

const seguro = (s: string) => String(s ?? '').replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');
const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const horas = (min: number) => {
  const h = min / 60;
  let t = h.toFixed(2);
  if (t.endsWith('0')) t = t.slice(0, -1);
  return t;
};
const hhmm = (t: string) => t.slice(0, 5);
const diaMes = (iso: string) => {
  const [, m, d] = iso.split('-').map(Number);
  return `${String(d).padStart(2, '0')} de ${MESES[m - 1]}`;
};

export async function buildReportePdf(d: DatosPdf): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Reporte de horas folio ${d.folio} - ${d.profesorNombre}`);
  pdf.setProducer('CUEJ · Sistema de asistencia docente');
  const page = pdf.addPage([792, H]);
  const reg = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const mono = await pdf.embedFont(StandardFonts.Courier);

  // --- utilidades en coordenadas "desde arriba" ---
  const rect = (x: number, top: number, w: number, h: number, color: ReturnType<typeof rgb>) =>
    page.drawRectangle({ x, y: H - top - h, width: w, height: h, color });
  const line = (x1: number, y1: number, x2: number, y2: number, t = 0.6) =>
    page.drawLine({ start: { x: x1, y: H - y1 }, end: { x: x2, y: H - y2 }, thickness: t, color: C.negro });
  const text = (s: string, x: number, base: number, size: number, font: PDFFont, color = C.negro) =>
    page.drawText(seguro(s), { x, y: H - base, size, font, color });
  const w = (s: string, size: number, font: PDFFont) => font.widthOfTextAtSize(seguro(s), size);
  const right = (s: string, xr: number, base: number, size: number, font: PDFFont, color = C.negro) =>
    text(s, xr - w(s, size, font), base, size, font, color);
  const center = (s: string, x1: number, x2: number, base: number, size: number, font: PDFFont, color = C.negro) =>
    text(s, (x1 + x2) / 2 - w(s, size, font) / 2, base, size, font, color);
  const fit = (s: string, maxW: number, size: number, font: PDFFont) => {
    let sz = size;
    while (sz > 4 && w(s, sz, font) > maxW) sz -= 0.2;
    return sz;
  };
  const corta = (s: string, maxW: number, size: number, font: PDFFont) => {
    let t = seguro(s);
    if (font.widthOfTextAtSize(t, size) <= maxW) return t;
    while (t.length > 1 && font.widthOfTextAtSize(t + '...', size) > maxW) t = t.slice(0, -1);
    return t + '...';
  };
  const wrap = (s: string, maxW: number, size: number, font: PDFFont) => {
    const out: string[] = [];
    let cur = '';
    for (const ch of seguro(s)) {
      if (font.widthOfTextAtSize(cur + ch, size) > maxW) {
        out.push(cur);
        cur = ch;
      } else cur += ch;
    }
    if (cur) out.push(cur);
    return out;
  };

  // --- datos agrupados por clase ---
  const clases = new Map<string, { grupo: string; materia: string; porDia: number[]; min: number }>();
  for (const s of d.sesiones) {
    const k = `${s.grupo}|${s.materia}`;
    if (!clases.has(k)) clases.set(k, { grupo: s.grupo, materia: s.materia, porDia: [0, 0, 0, 0, 0, 0, 0, 0], min: 0 });
    const c = clases.get(k)!;
    c.porDia[s.dia_semana] = Math.max(c.porDia[s.dia_semana], s.minutos); // horas por sesión (como el formato vigente)
    c.min += s.minutos;
  }
  const filas = [...clases.values()];
  const N = filas.length;
  const hayDomingo = d.sesiones.some((s) => s.dia_semana === 7);
  const dias = hayDomingo ? [1, 2, 3, 4, 5, 6, 7] : [1, 2, 3, 4, 5, 6];
  const LET = ['', 'L', 'M', 'M', 'J', 'V', 'S', 'D'];
  const tarifa = d.tarifa;
  const importe = (min: number) => Math.round((min / 60) * tarifa * 100) / 100;
  const totalMin = filas.reduce((a, f) => a + f.min, 0);
  const totalMonto = filas.reduce((a, f) => a + importe(f.min), 0);
  const [yy, mm] = d.desde.split('-').map(Number);
  const mesNombre = MESES[mm - 1];

  // --- encabezado ---
  const jpg = await pdf.embedJpg(Buffer.from(BANNER_JPG_BASE64, 'base64'));
  page.drawImage(jpg, { x: 50.4, y: H - 194.0, width: 630.1, height: 127.1 });

  const titulo = d.profesorNombre;
  center(titulo, 50.4, 519, 218.1, 14.5, bold, C.morado);

  text('ESPECIALIDAD', 52.6, 247.5, 7.9, bold, C.morado);
  text('PERIODO', 291.8, 247.5, 7.9, bold, C.morado);
  text('MATERIA IMPARTIDA', 519.4, 247.5, 7.9, bold, C.morado);
  rect(52.6, 248.3, 60.4, 0.9, C.morado);
  rect(291.8, 248.3, 36.4, 0.9, C.morado);
  rect(519.4, 248.3, 80.9, 0.9, C.morado);

  rect(50.9, 249.7, 681.3, 11.6, C.azul);
  rect(50.9, 261.2, 681.3, 11.6, C.rosa);
  const grupos = [...new Set(filas.map((f) => f.grupo))].join(', ');
  const materias = [...new Set(filas.map((f) => f.materia))].join(', ');
  const fechas = d.sesiones.map((s) => s.fecha).sort();
  const horarios = new Set(d.sesiones.map((s) => `${hhmm(s.hora_inicio)}-${hhmm(s.hora_fin)}`));
  const periodo =
    `Periodo: Del ${diaMes(fechas[0])} al ${diaMes(fechas[fechas.length - 1])}` +
    (horarios.size === 1 ? ` (${[...horarios][0]}hrs)` : '');
  text(corta(grupos, 210, 6, reg), 52.2, 259.0, 6, reg);
  text(corta(periodo, 240, 6.6, reg), 272.9, 259.0, 6.6, reg);
  text(corta(materias, 205, 6, reg), 519.1, 259.0, 6, reg);

  // --- tabla HRS IMPARTIDAS ---
  const rh = Math.min(11.55, 70 / (N + 1));
  const xL = 129.0, xD0 = 271.5, xD1 = 387.5, xT1 = 517.9;
  const dw = (xD1 - xD0) / dias.length;
  rect(xD0, 296.2, xD1 - xD0, 13.1, C.rosaH);
  text('HRS IMPARTIDAS', 296.1, 305.1, 7.9, bold);
  rect(xL, 309.2, xD0 - xL, 11.6, C.lila);
  text('CONCEPTO', 178.2, 318.5, 7.9, bold);
  rect(xD0, 309.2, xT1 - xD0, 11.6, C.rosaH);
  dias.forEach((di, i) => text(LET[di], xD0 + dw * i + dw / 2 - w(LET[di], 7.9, bold) / 2, 318.5, 7.9, bold));
  text('TOTAL DE HRS', 422.9, 318.5, 7.9, bold);

  const t0 = 320.7;
  for (let i = 0; i <= N; i++) {
    rect(xL, t0 + i * rh, xT1 - xL, rh, i % 2 === 0 ? C.azul : C.rosa);
  }
  const base = (top: number) => top + rh - 1.5;
  filas.forEach((f, i) => {
    const b = base(t0 + i * rh);
    text(f.grupo, 130.3, b, fit(f.grupo, 138, 6, reg), reg);
    dias.forEach((di, k) => {
      if (f.porDia[di] > 0) right(horas(f.porDia[di]), xD0 + dw * (k + 1) - 1.5, b, 6.6, reg);
    });
    right(horas(f.min), 516.3, b, 6.6, reg);
  });
  const hrsEnd = t0 + (N + 1) * rh;
  // líneas
  line(xL, 309.25, 518.5, 309.25, 1.3);
  line(xL - 0.6, 309.25, xL - 0.6, hrsEnd, 1.3);
  line(xD0, 296.5, 518.5, 296.5, 1.3);
  for (let i = 0; i <= N + 1; i++) line(xL, t0 + i * rh - 0.2, xT1, t0 + i * rh - 0.2, 0.6);
  line(xD0, 296.5, xD0, hrsEnd, 0.6);
  line(xD1, 296.5, xD1, hrsEnd, 0.6);
  dias.slice(0, -1).forEach((_, i) => line(xD0 + dw * (i + 1), 309.25, xD0 + dw * (i + 1), hrsEnd, 0.6));
  line(517.5, 309.25, 517.5, hrsEnd, 0.6);

  // --- DESGLOSE ---
  const dTop = hrsEnd + 34.4;
  rect(313.0, dTop, xT1 - 313.0, 11.6, C.gris);
  text('DESGLOSE', 133.3, dTop + 9.4, 7.9, reg);
  text('COSTO X HR', 314.7, dTop + 9.4, 7.9, reg);
  const d0 = dTop + 11.5;
  for (let i = 0; i <= N; i++) rect(xL, d0 + i * rh, xT1 - xL, rh, i % 2 === 0 ? C.azul : C.rosa);
  filas.forEach((f, i) => {
    const b = base(d0 + i * rh);
    text(f.grupo, 130.3, b, fit(f.grupo, 140, 6, reg), reg);
    right(horas(f.min), 290.0, b, 6, reg);
    text('HRS', 291.4, b, 6, reg);
    text('$' + money(tarifa), 330.4, b, 6, reg);
    text('$', 391.4, b, 7.2, reg);
    right(money(importe(f.min)), 513.8, b, 7.2, reg);
  });
  const dEnd = d0 + (N + 1) * rh;
  for (let i = 0; i <= N + 1; i++) line(xL, d0 + i * rh - 0.2, xT1, d0 + i * rh - 0.2, 0.6);

  // --- TOTAL ---
  const tTop = dEnd + 11.4;
  rect(xL, tTop, xT1 - xL, 12.1, C.banda);
  line(xL, tTop - 0.2, xT1, tTop - 0.2, 0.6);
  line(xL, tTop + 11.1, xT1, tTop + 11.1, 0.6);
  line(xL, tTop + 12.4, xT1, tTop + 12.4, 0.6);
  text(`TOTAL A PAGAR ${mesNombre.toUpperCase()} ${yy}`, 159.0, tTop + 9.1, 7.9, bold, C.blanco);
  text('$', 391.7, tTop + 9.1, 7.9, bold, C.blanco);
  right(money(totalMonto), 513.4, tTop + 9.1, 7.9, bold, C.blanco);

  // pie
  let fx = 130.7;
  const fb = tTop + 20.7;
  for (const [t, col] of [
    ['Enviar su factura a ', C.negro],
    ['proveedores@cuej.edu.mx', C.rojo],
    [' con copia a ', C.negro],
    ['docentes@cuej.edu.mx', C.rojo],
  ] as const) {
    text(t, fx, fb, 7.9, reg, col);
    fx += w(t, 7.9, reg);
  }

  // --- notas: faltas, retardos y reposiciones del periodo ---
  const corto = (iso: string) => {
    const [, m, dd] = iso.split('-').map(Number);
    return `${String(dd).padStart(2, '0')} ${MESES[m - 1].slice(0, 3)}`;
  };
  const faltas = d.faltas ?? [];
  const conDesc = d.sesiones.filter((x) => (x.descuento_min ?? 0) > 0);
  const repos = d.sesiones.filter((x) => x.es_reposicion);
  const notas: [string, string, ReturnType<typeof rgb>][] = [];
  if (faltas.length)
    notas.push([
      `FALTAS (${faltas.length}): `,
      faltas.map((f) => `${f.grupo} ${corto(f.fecha)}${f.repuesta_fecha ? ` (repuesta el ${corto(f.repuesta_fecha)})` : ' (sin reponer)'}`).join('; '),
      C.rojo,
    ]);
  if (conDesc.length)
    notas.push([
      'DESCUENTO POR RETARDO (tolerancia 10 min): ',
      conDesc.map((x) => `${x.grupo} ${corto(x.fecha)} -${x.descuento_min} min`).join('; '),
      C.morado,
    ]);
  if (repos.length)
    notas.push([
      'REPOSICIONES: ',
      repos.map((x) => `${x.grupo} ${corto(x.fecha)}${x.reposicion_de ? ` (falta del ${corto(x.reposicion_de)})` : ''}`).join('; '),
      C.morado,
    ]);
  if (!notas.length) notas.push(['', 'Sin faltas ni retardos en el periodo.', C.gris2]);
  let ny = fb + 13;
  for (const [etq, cuerpo, col] of notas) {
    const lineas = wrapPalabras(etq + cuerpo, 388, 6.4, reg);
    const maxL = Math.max(1, Math.floor((592 - ny) / 7.4));
    lineas.slice(0, maxL).forEach((l, i) => {
      if (i === 0 && etq) {
        text(etq, 130.7, ny, 6.4, bold, col);
        text(l.slice(etq.length), 130.7 + w(etq, 6.4, bold), ny, 6.4, reg);
      } else text(l, 130.7, ny, 6.4, reg);
      ny += 7.4;
    });
    if (lineas.length > maxL) text('...', 130.7, ny - 7.4, 6.4, reg);
    ny += 2;
  }

  // --- calendario ---
  const cx0 = 538.6, cw = 27.6;
  rect(539.0, 296.2, 193.5, 13.1, C.banda);
  center(`${mesNombre} '${String(yy).slice(2)}`, 539, 732.5, 305.6, 10, bold, C.blanco);
  rect(539.0, 309.2, 193.5, 11.6, C.gris);
  ['D', 'L', 'M', 'M', 'J', 'V', 'S'].forEach((l, i) =>
    center(l, cx0 + cw * i, cx0 + cw * (i + 1), 317.1, 6.6, bold, C.gris2)
  );
  const conClase = new Set(d.sesiones.map((s) => Number(s.fecha.slice(8, 10))));
  const primero = new Date(Date.UTC(yy, mm - 1, 1)).getUTCDay();
  const diasMes = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  const filaY = (k: number) => 320.5 + k * 11.5;
  for (let dia = 1; dia <= diasMes; dia++) {
    const pos = primero + dia - 1;
    const col = pos % 7, fila = Math.floor(pos / 7);
    if (conClase.has(dia)) rect(cx0 + cw * col + 0.3, filaY(fila) + 0.3, cw - 0.6, 11.0, C.azul);
    const finde = col === 0 || col === 6;
    center(String(dia), cx0 + cw * col, cx0 + cw * (col + 1), filaY(fila) + 8.6, 7.9, bold, finde ? C.negro : C.banda);
  }
  for (let k = 0; k <= 7; k++) line(cx0, 308.9 + k * 11.5, 731.9, 308.9 + k * 11.5, 0.6);
  for (let i = 0; i <= 7; i++) {
    const outer = i === 0 || i === 7;
    line(cx0 + cw * i, outer ? 296.5 : 309.2, cx0 + cw * i, 389.6, 0.6);
  }

  // --- bloque de sello digital (parte inferior derecha) ---
  const bx = 539, bw = 193.5;
  let by = 400;
  rect(bx, by, bw, 11, C.banda);
  text('SELLO DIGITAL DEL REPORTE', bx + 4, by + 8, 6.6, bold, C.blanco);
  by += 15;
  const qs = 84;
  const n = d.qr.length;
  const m = qs / n;
  rect(bx, by, qs, qs, C.blanco);
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++) if (d.qr[r][c]) rect(bx + c * m, by + r * m, m + 0.05, m + 0.05, C.negro);
  const emision = new Date(d.fechaEmision).toLocaleString('es-MX', {
    timeZone: 'America/Mexico_City', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const tx = bx + qs + 6;
  const info: [string, string][] = [
    ['Folio', String(d.folio)],
    ['Emisión', emision],
    ['Periodo', `${d.desde} al ${d.hasta}`],
    ['Sesiones', `${d.sesiones.length}  ·  ${horas(totalMin)} h  ·  ${faltas.length} falta(s)`],
    ['Serie', d.serie],
  ];
  let ty = by + 8;
  for (const [k, v] of info) {
    text(k, tx, ty, 6, bold, C.morado);
    text(v, tx, ty + 7.5, fit(v, bw - qs - 8, 6.4, reg), reg);
    ty += 16;
  }
  by += qs + 7;
  text('Sello digital', bx, by, 6, bold, C.morado);
  by += 6;
  for (const l of wrap(d.sello, bw, 4.8, mono)) { text(l, bx, by + 4, 4.8, mono); by += 5.4; }
  by += 4;
  text('Cadena original', bx, by + 2, 6, bold, C.morado);
  by += 8;
  for (const l of wrap(d.cadena, bw, 4.8, mono)) { text(l, bx, by + 4, 4.8, mono); by += 5.4; }
  by += 5;
  const nota = 'Documento de control interno con sello electrónico propio de CUEJ. No es un comprobante fiscal (CFDI) ni sustituye la factura. Verifique su autenticidad escaneando el código QR.';
  for (const l of wrapPalabras(nota, bw, 5.4, reg)) { text(l, bx, by + 4, 5.4, reg, C.gris2); by += 6.2; }

  if (d.anulado) {
    page.drawText('ANULADO', {
      x: 150, y: H - 470, size: 90, font: bold, color: rgb(0.85, 0.1, 0.1), opacity: 0.25, rotate: { type: 'degrees' as any, angle: 25 },
    });
  }
  return pdf.save();

  function wrapPalabras(s: string, maxW: number, size: number, font: PDFFont) {
    const out: string[] = [];
    let cur = '';
    for (const p of seguro(s).split(' ')) {
      const t = cur ? cur + ' ' + p : p;
      if (font.widthOfTextAtSize(t, size) > maxW) { out.push(cur); cur = p; } else cur = t;
    }
    if (cur) out.push(cur);
    return out;
  }
}
