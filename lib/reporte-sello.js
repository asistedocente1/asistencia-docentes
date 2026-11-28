"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hashDetalle = hashDetalle;
exports.construirCadena = construirCadena;
exports.serieDeLlave = serieDeLlave;
exports.firmar = firmar;
exports.verificarSello = verificarSello;
// Cadena original y sello digital de los reportes de horas. SOLO servidor.
// El sello es una firma electrónica interna (RSA-SHA256) del CUEJ; no es un timbre del SAT.
const node_crypto_1 = require("node:crypto");
const limpia = (s) => String(s).replace(/\|/g, ' ').replace(/\s+/g, ' ').trim();
const dos = (n) => Number(n).toFixed(2);
function hashDetalle(det) {
    const lineas = [...det]
        .sort((a, b) => (a.asistencia_id < b.asistencia_id ? -1 : a.asistencia_id > b.asistencia_id ? 1 : 0))
        .map((d) => `${d.asistencia_id}|${d.fecha}|${d.minutos}`)
        .join('\n');
    return (0, node_crypto_1.createHash)('sha256').update(lineas, 'utf8').digest('hex');
}
function construirCadena(d, det) {
    return ('||1.0|' +
        [
            limpia(String(d.folio)),
            d.id,
            d.fecha_emision,
            d.profesor_id,
            limpia(d.profesor_nombre),
            d.desde,
            d.hasta,
            d.total_minutos,
            dos(d.tarifa),
            dos(d.monto),
            d.num_sesiones,
            hashDetalle(det),
        ].join('|') +
        '||');
}
/** La llave puede venir en PEM (con \n literales) o como base64 del PEM completo */
function leerPem() {
    let k = (process.env.REPORTE_PRIVATE_KEY || '').trim();
    if (!k)
        throw new Error('Falta la variable REPORTE_PRIVATE_KEY (ver README)');
    if (!k.includes('BEGIN'))
        k = Buffer.from(k, 'base64').toString('utf8');
    return k.replace(/\\n/g, '\n');
}
function serieDeLlave() {
    const pub = (0, node_crypto_1.createPublicKey)((0, node_crypto_1.createPrivateKey)(leerPem()));
    const der = pub.export({ type: 'spki', format: 'der' });
    return (0, node_crypto_1.createHash)('sha1').update(der).digest('hex').slice(0, 20).toUpperCase();
}
function firmar(cadena) {
    const s = (0, node_crypto_1.createSign)('RSA-SHA256');
    s.update(cadena, 'utf8');
    return { sello: s.sign((0, node_crypto_1.createPrivateKey)(leerPem()), 'base64'), serie: serieDeLlave() };
}
function verificarSello(cadena, sello) {
    try {
        const pub = (0, node_crypto_1.createPublicKey)((0, node_crypto_1.createPrivateKey)(leerPem()));
        const v = (0, node_crypto_1.createVerify)('RSA-SHA256');
        v.update(cadena, 'utf8');
        return v.verify(pub, sello, 'base64');
    }
    catch {
        return false;
    }
}
