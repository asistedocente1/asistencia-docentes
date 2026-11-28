import QRCode from 'qrcode';

/** Matriz de módulos del QR (true = negro), para dibujarlo en vector dentro del PDF */
export function matrizQR(texto: string): boolean[][] {
  const q: any = (QRCode as any).create(texto, { errorCorrectionLevel: 'M' });
  const n: number = q.modules.size;
  const m: boolean[][] = [];
  for (let r = 0; r < n; r++) {
    const fila: boolean[] = [];
    for (let c = 0; c < n; c++) fila.push(!!q.modules.get(r, c));
    m.push(fila);
  }
  return m;
}
