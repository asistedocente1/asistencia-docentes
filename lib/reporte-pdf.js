"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generarPdf = generarPdf;
// Genera el PDF del reporte de horas (carta horizontal) con el formato vigente del CUEJ,
// más código QR, sello digital y cadena original. SOLO servidor.
const pdf_lib_1 = require("pdf-lib");
const qrcode_1 = __importDefault(require("qrcode"));
const reporte_banner_1 = require("./reporte-banner");
const reporte_calc_1 = require("./reporte-calc");
const H = 612;
const hex = (h) => (0, pdf_lib_1.rgb)(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
const C = {
    morado: hex('#481347'), purpura: hex('#6d1d6b'), azul: hex('#9bb5ea'), rosa: hex('#fcd8f5'),
    rosaH: hex('#f1cbf0'), lila: hex('#a39dd5'), gris: hex('#f2f2f2'), negro: (0, pdf_lib_1.rgb)(0, 0, 0),
    blanco: (0, pdf_lib_1.rgb)(1, 1, 1), rojo: hex('#ff0000'), grisTxt: hex('#404040'),
};
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DIAS_L = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
const limpia = (s) => String(s).replace(/[^\x20-\x7E -ÿ]/g, ' ');
const money = (n) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ymd = (s) => s.split('-').map(Number);
const fechaLarga = (s) => { const [, m, d] = ymd(s); return `${String(d).padStart(2, '0')} de ${MESES[m - 1]}`; };
const hm = (t) => t.slice(0, 5);
async function generarPdf(d) {
    const pdf = await pdf_lib_1.PDFDocument.create();
    pdf.setTitle(`Reporte de horas ${d.folio} - ${d.profesor_nombre}`);
    pdf.setAuthor('CUEJ');
    pdf.setCreator('Sistema de asistencia docente CUEJ');
    const page = pdf.addPage([792, 612]);
    const reg = await pdf.embedFont(pdf_lib_1.StandardFonts.Helvetica);
    const bold = await pdf.embedFont(pdf_lib_1.StandardFonts.HelveticaBold);
    const mono = await pdf.embedFont(pdf_lib_1.StandardFonts.Courier);
    // ---- utilidades con coordenadas "desde arriba" (como en el formato original)
    const rect = (x1, t1, x2, t2, color) => page.drawRectangle({ x: x1, y: H - t2, width: x2 - x1, height: t2 - t1, color });
    const text = (s, x, base, size, font = reg, color = C.negro) => page.drawText(limpia(s), { x, y: H - base, size, font, color });
    const textR = (s, xr, base, size, font = reg, color = C.negro) => text(s, xr - font.widthOfTextAtSize(limpia(s), size), base, size, font, color);
    const textC = (s, xc, base, size, font = reg, color = C.negro) => text(s, xc - font.widthOfTextAtSize(limpia(s), size) / 2, base, size, font, color);
    const vline = (x, t1, t2, w = 0.6, color = C.negro) => page.drawLine({ start: { x, y: H - t1 }, end: { x, y: H - t2 }, thickness: w, color });
    const hline = (t, x1, x2, w = 0.6, color = C.negro) => page.drawLine({ start: { x: x1, y: H - t }, end: { x: x2, y: H - t }, thickness: w, color });
    const fit = (s, size, font, maxW) => {
        let t = limpia(s);
        while (t.length > 1 && font.widthOfTextAtSize(t, size) > maxW)
            t = t.slice(0, -1);
        return t.length < limpia(s).length ? t.trimEnd() + '.' : t;
    };
    // ---- datos
    const filas = (0, reporte_calc_1.agruparPorClase)(d.sesiones, d.tarifa);
    const N = filas.length;
    const totMin = filas.reduce((a, f) => a + f.minutos, 0);
    const total = (0, reporte_calc_1.totalMonto)(filas);
    const hayDom = filas.some((f) => f.porDia[7]);
    const fechas = d.sesiones.map((s) => s.fecha).sort();
    const primera = fechas[0];
    const ultima = fechas[fechas.length - 1];
    const horarios = new Set(d.sesiones.map((s) => `${hm(s.hora_inicio)}-${hm(s.hora_fin)}`));
    const horarioTxt = horarios.size === 1 ? ` (${[...horarios][0]}hrs)` : '';
    const [, mesH, anioH] = (() => { const [y, m] = ymd(d.hasta); return [0, m, y]; })();
    const [anioC, mesC] = ymd(d.desde);
    const rh = Math.min(11.55, 68 / (N + 1));
    const fs = Math.min(6, rh * 0.55);
    const fsN = Math.min(6.6, rh * 0.58);
    // ---- banner
    const img = reporte_banner_1.BANNER_KIND === 'jpg' ? await pdf.embedJpg(Buffer.from(reporte_banner_1.BANNER_B64, 'base64')) : await pdf.embedPng(Buffer.from(reporte_banner_1.BANNER_B64, 'base64'));
    page.drawImage(img, { x: 50.4, y: H - 194.0, width: 630.1, height: 127.1 });
    // ---- título
    textC(d.profesor_nombre, 284.7 + 0, 218.1, 14.5, bold, C.morado);
    // (el original lo centra en la zona izquierda; mantenemos la misma posición)
    // ---- etiquetas
    const grupos = [...new Set(filas.map((f) => f.grupo))].join(', ');
    const materias = [...new Set(filas.map((f) => f.materia))].join(', ');
    const labels = [['ESPECIALIDAD', 52.6, 113.0], ['PERIODO', 291.8, 328.2], ['MATERIA IMPARTIDA', 519.4, 600.3]];
    for (const [t, x1, x2] of labels) {
        text(t, x1, 247.5, 7.9, bold, C.morado);
        rect(x1, 248.3, x2, 249.2, C.morado);
    }
    // ---- filas de información (una por clase)
    const infoTop = 249.7;
    for (let i = 0; i <= N; i++) {
        const t1 = infoTop + i * rh;
        rect(50.9, t1, 732.2, t1 + rh + 0.1, i % 2 === 0 && i < N ? C.azul : i % 2 === 1 && i < N ? C.rosa : (N % 2 === 0 ? C.azul : C.rosa));
        if (i < N) {
            const f = filas[i];
            const base = t1 + rh * 0.8;
            text(fit(f.grupo, fs, reg, 215), 52.2, base, fs);
            const p = `Periodo: Del ${fechaLarga(f.fechas[0])} al ${fechaLarga(f.fechas[f.fechas.length - 1])}`;
            text(fit(p, fsN, reg, 240), 272.9, base, fsN);
            text(fit(f.materia, fs, reg, 210), 519.1, base, fs);
        }
    }
    void primera;
    void ultima;
    void horarioTxt;
    void grupos;
    void materias;
    const infoEnd = infoTop + (N + 1) * rh;
    // ---- HRS IMPARTIDAS
    const hTop = infoEnd + 23.4;
    const xs = hayDom ? [271.2, ...Array.from({ length: 7 }, (_, i) => 271.2 + ((387.2 - 271.2) / 7) * (i + 1))] : [271.2, 289.9, 312.8, 331.4, 350.0, 368.6, 387.2];
    const dias = hayDom ? [1, 2, 3, 4, 5, 6, 7] : [1, 2, 3, 4, 5, 6];
    rect(271.5, hTop, 387.5, hTop + 13.1, C.rosaH);
    text('HRS IMPARTIDAS', 296.1, hTop + 8.9, 7.9, bold);
    const h2 = hTop + 13.0;
    rect(129.0, h2, 271.6, h2 + 11.6, C.lila);
    text('CONCEPTO', 178.2, h2 + 9.3, 7.9, bold);
    rect(271.5, h2, 517.9, h2 + 11.6, C.rosaH);
    dias.forEach((dia, i) => textC(DIAS_L[dia - 1], (xs[i] + xs[i + 1]) / 2 + 0.3, h2 + 9.3, 7.9, bold));
    text('TOTAL DE HRS', 422.9, h2 + 9.3, 7.9, bold);
    const dTop = h2 + 11.6;
    const dEnd = dTop + (N + 1) * rh;
    for (let i = 0; i <= N; i++) {
        const t1 = dTop + i * rh;
        rect(129.0, t1, 517.9, t1 + rh + 0.1, i % 2 === 0 ? C.azul : C.rosa);
        if (i < N) {
            const f = filas[i];
            const base = t1 + rh * 0.8;
            text(fit(f.grupo, fs, reg, 138), 130.3, base, fs);
            dias.forEach((dia, k) => { if (f.porDia[dia])
                textR((0, reporte_calc_1.fmtHoras)(f.porDia[dia]), xs[k + 1] - 1.3, base, fsN); });
            textR((0, reporte_calc_1.fmtHoras)(f.minutos), 516.3, base, fsN);
        }
        hline(t1 + rh, 129.0, 517.9, 0.4);
    }
    for (const x of [...xs, 517.5])
        vline(x, hTop === 0 ? 0 : h2, dEnd, 0.6);
    vline(271.2, hTop, h2, 0.6);
    vline(387.2, hTop, h2, 0.6);
    hline(h2, 129.7, 518.5, 1.3);
    vline(129.0, hTop + 13, dEnd, 1.3);
    hline(hTop, 271.5, 387.5, 1.3);
    // ---- DESGLOSE
    const gTop = dEnd + 34.4;
    rect(313.0, gTop, 517.9, gTop + 11.6, C.gris);
    text('DESGLOSE', 133.3, gTop + 9.4, 7.9, bold);
    text('COSTO X HR', 314.7, gTop + 9.4, 7.9, bold);
    const gData = gTop + 11.5;
    for (let i = 0; i <= N; i++) {
        const t1 = gData + i * rh;
        rect(129.0, t1, 517.9, t1 + rh + 0.1, i % 2 === 0 ? C.azul : C.rosa);
        if (i < N) {
            const f = filas[i];
            const base = t1 + rh * 0.8;
            text(fit(f.grupo, fs, reg, 138), 130.3, base, fs);
            text((0, reporte_calc_1.fmtHoras)(f.minutos), 280.4, base, fs);
            text('HRS', 291.4, base, fs);
            text('$' + money(d.tarifa), 330.4, base, fs);
            text('$', 391.4, base, fsN);
            textR(money(f.monto), 513.8, base, fsN);
        }
    }
    const gEnd = gData + (N + 1) * rh;
    // ---- TOTAL
    const tTop = gEnd + 11.4;
    rect(129.0, tTop, 517.9, tTop + 12.1, C.purpura);
    hline(tTop, 129.0, 517.9, 0.6);
    hline(tTop + 11.3, 129.0, 517.9, 0.6);
    hline(tTop + 12.6, 129.0, 517.9, 0.6);
    text(`TOTAL A PAGAR ${MESES[mesH - 1].toUpperCase()} ${anioH}`, 159.0, tTop + 9.1, 7.9, bold, C.blanco);
    text('$', 391.7, tTop + 9.1, 7.9, bold, C.blanco);
    textR(money(total), 513.4, tTop + 9.1, 7.9, bold, C.blanco);
    // pie (en el original: Century Gothic)
    let x = 130.7;
    const pie = [['Enviar su factura a ', C.negro], ['proveedores@cuej.edu.mx', C.rojo], [' con copia a ', C.negro], ['docentes@cuej.edu.mx', C.rojo]];
    for (const [s, col] of pie) {
        text(s, x, tTop + 20.7, 7.9, reg, col);
        x += reg.widthOfTextAtSize(s, 7.9);
    }
    // ---- calendario
    const cx = Array.from({ length: 8 }, (_, i) => 538.6 + 27.6 * i);
    cx[7] = 731.9;
    rect(539, 296.2, 732.5, 309.3, C.purpura);
    textC(`${MESES[mesC - 1]} '${String(anioC).slice(2)}`, 635.3, 305.6, 10, bold, C.blanco);
    rect(539, 309.2, 732.5, 320.8, C.gris);
    DIAS_L.slice(-1).concat(DIAS_L.slice(0, 6)).forEach((l, i) => textC(l, (cx[i] + cx[i + 1]) / 2, 317.1, 6.6, bold, C.grisTxt));
    const conClase = new Set(fechas.map((f) => Number(f.slice(8))));
    const primerDow = new Date(Date.UTC(anioC, mesC - 1, 1)).getUTCDay(); // 0=domingo
    const diasMes = new Date(Date.UTC(anioC, mesC, 0)).getUTCDate();
    const rowTops = [320.5, 332.0, 343.5, 355.0, 366.5, 378.1];
    for (let dia = 1; dia <= diasMes; dia++) {
        const pos = primerDow + dia - 1;
        const r = Math.floor(pos / 7), c = pos % 7;
        if (conClase.has(dia))
            rect(cx[c], rowTops[r], cx[c + 1], rowTops[r] + 11.5, C.azul);
    }
    for (let dia = 1; dia <= diasMes; dia++) {
        const pos = primerDow + dia - 1;
        const r = Math.floor(pos / 7), c = pos % 7;
        textC(String(dia), (cx[c] + cx[c + 1]) / 2, rowTops[r] + 8.7, 7.9, bold, c === 0 || c === 6 ? C.negro : C.purpura);
    }
    for (const t of [308.9, ...rowTops, 389.6])
        hline(t, 538.6, 731.9, 0.5);
    for (const v of cx)
        vline(v, 308.9, 389.6, 0.5);
    // ---- bloque de QR, sello y cadena
    const bx = 539, bw = 193.5;
    let by = 400;
    rect(bx, by, bx + bw, by + 9.5, C.purpura);
    text('SELLO DIGITAL DEL REPORTE', bx + 4, by + 6.9, 6.4, bold, C.blanco);
    by += 12;
    const qr = qrcode_1.default.create(d.verifyUrl, { errorCorrectionLevel: 'M' });
    const n = qr.modules.size;
    const q = 74, cell = q / n, qx = bx, qy = by;
    rect(qx - 2, qy - 2, qx + q + 2, qy + q + 2, C.blanco);
    for (let r = 0; r < n; r++)
        for (let c = 0; c < n; c++)
            if (qr.modules.get(r, c))
                page.drawRectangle({ x: qx + c * cell, y: H - (qy + (r + 1) * cell), width: cell + 0.15, height: cell + 0.15, color: C.negro });
    const fe = new Date(d.fecha_emision).toLocaleString('es-MX', { timeZone: 'America/Mexico_City', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    const tx = bx + q + 7;
    const info = [
        ['Folio', String(d.folio).padStart(6, '0')],
        ['Fecha de emisión', fe],
        ['Periodo cubierto', `${d.desde} al ${d.hasta}`],
        ['Serie del sello', d.serie],
        ['Horas / Importe', `${(0, reporte_calc_1.fmtHoras)(totMin)} h / $${money(total)}`],
    ];
    let iy = by + 6;
    for (const [k, v] of info) {
        text(k, tx, iy, 5.4, bold, C.morado);
        text(fit(v, 6.2, reg, bx + bw - tx), tx, iy + 7, 6.2, reg);
        iy += 15.2;
    }
    by += q + 6;
    const wrapMono = (s, size, width) => {
        const per = Math.max(1, Math.floor(width / mono.widthOfTextAtSize('M', size)));
        const out = [];
        for (let i = 0; i < s.length; i += per)
            out.push(s.slice(i, i + per));
        return out;
    };
    const bloque = (titulo, cuerpo) => {
        text(titulo, bx, by + 5, 5.6, bold, C.morado);
        by += 7.5;
        for (const l of wrapMono(cuerpo, 4.9, bw)) {
            text(l, bx, by + 4.2, 4.9, mono);
            by += 5.6;
        }
        by += 2.5;
    };
    bloque('SELLO DIGITAL (RSA-SHA256)', d.sello);
    bloque('CADENA ORIGINAL', d.cadena);
    const nota = 'Documento de control interno firmado electrónicamente por el CUEJ. No es un comprobante fiscal (CFDI) ni sustituye la factura. Escanee el código QR para verificar su autenticidad.';
    const words = nota.split(' ');
    let line = '';
    for (const w of words) {
        if (reg.widthOfTextAtSize(line + w, 5.2) > bw) {
            text(line, bx, by + 4.5, 5.2, reg, C.grisTxt);
            by += 6;
            line = '';
        }
        line += w + ' ';
    }
    if (line)
        text(line, bx, by + 4.5, 5.2, reg, C.grisTxt);
    // ---- marca de agua si está anulado
    if (d.anulado) {
        page.drawText('ANULADO', { x: 150, y: 150, size: 110, font: bold, color: (0, pdf_lib_1.rgb)(0.85, 0.1, 0.1), opacity: 0.28, rotate: (0, pdf_lib_1.degrees)(28) });
    }
    return pdf.save();
}
void reporte_calc_1.montoMinutos;
