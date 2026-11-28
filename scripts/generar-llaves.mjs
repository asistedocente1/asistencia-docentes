// Genera la llave con la que se firman los reportes de horas.
// Uso:  node scripts/generar-llaves.mjs
// Copia el valor impreso en Vercel > Settings > Environment Variables > REPORTE_PRIVATE_KEY
// GUÁRDALA también en un lugar seguro: si se pierde, los reportes anteriores ya no podrán verificarse.
import { generateKeyPairSync } from 'node:crypto';
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
console.log('\nREPORTE_PRIVATE_KEY (copiar todo en una sola línea):\n');
console.log(Buffer.from(pem).toString('base64'));
console.log('');
