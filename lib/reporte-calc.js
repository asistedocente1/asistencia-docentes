"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fmtHoras = exports.totalMonto = exports.montoMinutos = void 0;
exports.agruparPorClase = agruparPorClase;
/** Importe en pesos de unos minutos a una tarifa por hora, redondeado a centavos */
const montoMinutos = (minutos, tarifa) => Math.round((minutos * Math.round(tarifa * 100)) / 60) / 100;
exports.montoMinutos = montoMinutos;
function agruparPorClase(ses, tarifa) {
    const m = new Map();
    for (const s of [...ses].sort((a, b) => a.fecha.localeCompare(b.fecha))) {
        let f = m.get(s.clase_id);
        if (!f) {
            f = { clase_id: s.clase_id, grupo: s.grupo, materia: s.materia, plantel: s.plantel, porDia: {}, minutos: 0, monto: 0, fechas: [] };
            m.set(s.clase_id, f);
        }
        f.porDia[s.dia_semana] = (f.porDia[s.dia_semana] || 0) + s.minutos;
        f.minutos += s.minutos;
        f.fechas.push(s.fecha);
    }
    const filas = [...m.values()].sort((a, b) => a.grupo.localeCompare(b.grupo) || a.materia.localeCompare(b.materia));
    for (const f of filas)
        f.monto = (0, exports.montoMinutos)(f.minutos, tarifa);
    return filas;
}
const totalMonto = (filas) => Math.round(filas.reduce((a, f) => a + Math.round(f.monto * 100), 0)) / 100;
exports.totalMonto = totalMonto;
/** Horas con 1 decimal si es exacto a décimas (2.0), si no con 2 (1.75) */
const fmtHoras = (min) => {
    const h = min / 60;
    return Math.abs(h * 10 - Math.round(h * 10)) < 1e-9 ? h.toFixed(1) : h.toFixed(2);
};
exports.fmtHoras = fmtHoras;
