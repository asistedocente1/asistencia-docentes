'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { LOGO_URL } from '@/lib/config';
import { fmtDate, fmtDateTime, money } from '@/lib/format';

type Resp = {
  encontrado: boolean; autentico?: boolean; estado?: 'vigente' | 'anulado'; anulado_at?: string | null;
  folio?: number; profesor?: string; desde?: string; hasta?: string; horas?: number; monto?: number;
  sesiones?: number; fecha_emision?: string; serie?: string;
};

function Contenido() {
  const sp = useSearchParams();
  const id = sp.get('id') || '';
  const fe = sp.get('fe') || '';
  const [r, setR] = useState<Resp | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`/api/verificar?id=${encodeURIComponent(id)}&fe=${encodeURIComponent(fe)}`)
      .then((x) => x.json())
      .then(setR)
      .catch(() => setError('No se pudo consultar. Intenta de nuevo.'));
  }, [id, fe]);

  const ok = r?.encontrado && r.autentico && r.estado === 'vigente';
  return (
    <div className="login-wrap">
      <div className="login-card" style={{ maxWidth: 460 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={LOGO_URL} alt="CUEJ" style={{ maxWidth: 180, display: 'block', margin: '0 auto 12px' }} />
        <h1 style={{ textAlign: 'center', fontSize: '1.2rem' }}>Verificación de reporte de horas</h1>
        {error && <div className="msg err">{error}</div>}
        {!r && !error && <p className="sub" style={{ textAlign: 'center' }}>Verificando…</p>}
        {r && !r.encontrado && <div className="msg err">No se encontró un reporte con estos datos. El documento podría no ser auténtico.</div>}
        {r?.encontrado && (
          <>
            {ok && <div className="msg ok"><strong>Documento auténtico y vigente.</strong> El sello digital es válido.</div>}
            {r.estado === 'anulado' && <div className="msg err"><strong>Reporte ANULADO</strong>{r.anulado_at ? ` el ${fmtDateTime(r.anulado_at)}` : ''}. No debe usarse para pago.</div>}
            {r.estado === 'vigente' && !r.autentico && <div className="msg err"><strong>El sello NO coincide.</strong> El documento o sus datos fueron alterados.</div>}
            <dl className="verif">
              <dt>Folio</dt><dd>{r.folio}</dd>
              <dt>Docente</dt><dd>{r.profesor}</dd>
              <dt>Periodo</dt><dd>{fmtDate(r.desde!)} al {fmtDate(r.hasta!)}</dd>
              <dt>Horas</dt><dd>{(r.horas ?? 0).toFixed(2)} h en {r.sesiones} sesiones</dd>
              <dt>Monto</dt><dd>{money(r.monto ?? 0)}</dd>
              <dt>Emitido</dt><dd>{fmtDateTime(r.fecha_emision!)}</dd>
              <dt>Serie</dt><dd style={{ fontFamily: 'monospace' }}>{r.serie}</dd>
            </dl>
            <p className="sub" style={{ fontSize: '0.8rem' }}>
              Documento de control interno con sello electrónico de CUEJ; no es un CFDI. Compara estos datos con el PDF impreso.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

export default function Verificar() {
  return (
    <Suspense fallback={null}>
      <Contenido />
    </Suspense>
  );
}
