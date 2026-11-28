# CUEJ · Sistema de asistencia docente

Next.js 14 + Supabase (base de datos, autenticación y fotos) + Vercel (despliegue). Código en GitHub.

## Roles

| Rol | Puede |
|---|---|
| **Super administrador** | Todo. Da de alta y edita administradores, control escolar y usuarios de apertura. Ve la bitácora. |
| **Administrador** | Da de alta y edita profesores, asigna y edita clases y horarios, abre clases, consulta asistencias, reportes y bitácora. |
| **Profesor** | Registra su entrada y salida (con foto) solo de sus clases, el día que le tocan. |
| **Control escolar** | Solo consulta (dashboard, asistencias con fotos, reportes). No puede modificar nada. |
| **Usuario de apertura** | Únicamente ve el módulo **Apertura de clases** (por ejemplo, una cuenta para la tableta de recepción). No ve usuarios, reportes, fotos ni bitácora. |

Los permisos están protegidos en la base de datos (Row Level Security), no solo ocultos en el menú.

## Cómo funciona el registro

### Desde el módulo «Apertura de clases» (recuadros)
Muestra las clases de hoy como recuadros (con filtro por plantel y buscador). Estados: *Aún no disponible*, *Disponible*, *En curso*, *Concluida* y *Sin registro*. El orden de los recuadros no cambia solo, para evitar tocar el equivocado.

- **Clase presencial:** el profesor (o quien opera el equipo) toca el recuadro y queda registrada la entrada. En ese momento se toma una foto sin vista previa.
- **Clase en línea:** al tocar el recuadro se toma la foto y se pide la **contraseña del profesor**. La contraseña se verifica en el servidor contra la cuenta con la que se dio de alta al profesor; con 5 intentos fallidos en 15 minutos se bloquea temporalmente y cada intento fallido queda en la bitácora.
- **Salida:** al tocar un recuadro «En curso» se registra la salida (presencial: pide confirmar; en línea: pide la contraseña). También con foto.

La modalidad de cada clase (presencial / en línea) se define en **Clases y horarios**.

### Desde «Mi asistencia» (profesor, en su propio celular)
Sigue disponible: el profesor entra con su usuario, toca su clase y se registra con foto.

### Reglas comunes
1. La **hora la pone el servidor** (no el equipo), por lo que no se puede alterar cambiando el reloj.
2. La entrada se habilita 30 min antes del inicio de la clase y hasta que termina. Se calcula el retardo.
3. **Horas a pagar** = tiempo entre entrada y salida, sin exceder la duración programada de la clase.
4. Cada asistencia guarda el **horario vigente cuando se registró**: editar una clase después no cambia lo ya registrado.
5. Reportes: horas × pago por hora por profesor, retardos, clases sin salida y **faltas** (clases programadas sin registro). Exporta a CSV para Excel.

## Reportes de horas con folio y sello

Menú **Reportes de horas → Horas por profesor**: aparece **una tarjeta por docente** con una **casilla por cada clase** que impartió en el periodo (marcadas por defecto las que tienen horas pendientes). Al elegir las clases y pulsar **Generar reporte** se emite el PDF con el formato de pago de CUEJ, con:

- **Folio** consecutivo (no se reutiliza).
- **Código QR** que lleva a una página pública de verificación (`/verificar`) donde se confirma que el reporte es auténtico, vigente o anulado.
- **Sello digital** (firma RSA-SHA256) y **cadena original** impresos en el PDF, como en un CFDI.

Reglas: solo Super administrador y Administrador emiten y anulan; Control escolar consulta y descarga. Un reporte abarca un solo mes y hasta 7 clases. Cada sesión solo puede estar en **un reporte vigente** (evita pagar dos veces); para corregir, se **anula** (con motivo) y se emite otro. Los reportes emitidos no se pueden editar ni borrar y todo queda en la bitácora. El pago por hora se congela en el reporte al emitirlo.

> El sello es **interno** de CUEJ (firma electrónica propia). **No es un timbre del SAT ni un CFDI**, y el PDF lo indica.

**Configurar la llave de firma (una sola vez):**
```bash
npm install
npm run generar-llaves      # imprime una línea larga
```
Copia esa línea en Vercel → Settings → Environment Variables → `REPORTE_PRIVATE_KEY` (y vuelve a desplegar). **Guárdala también en un lugar seguro**: si cambia o se pierde, los reportes ya emitidos dejarán de verificarse como auténticos. Opcional: `NEXT_PUBLIC_SITE_URL` (por ejemplo `https://asistencia.cuej.edu.mx`) para fijar el dominio que lleva el QR.

## Bitácora

Solo la ven el Super administrador y el Administrador. Registra quién hizo qué y cuándo: altas y ediciones de usuarios (con el antes y después; nunca guarda contraseñas), altas/ediciones/desactivaciones de clases, aperturas y cierres de clase (y quién los hizo), inicios de sesión y contraseñas incorrectas en aperturas en línea. No se puede editar ni borrar desde el sistema.

## Puesta en marcha (instalación nueva)

### 1. Supabase
1. Crea un proyecto en https://supabase.com.
2. **SQL Editor** → ejecuta, en este orden y cada uno por separado:
   1. `supabase/schema.sql`
   2. `supabase/migraciones/02a-rol-apertura.sql`
   3. `supabase/migraciones/02b-cambios.sql`
   4. `supabase/migraciones/03-reportes-emitidos.sql`
3. **Authentication → Users → Add user**: crea tu usuario (correo y contraseña).
4. En el SQL Editor ejecuta (con tu correo) para volverte Super administrador:
   ```sql
   insert into public.profiles (id, full_name, email, role)
   select id, 'Tu nombre', email, 'super_admin' from auth.users
    where email = 'TU_CORREO@cuej.edu.mx';
   ```
5. Llaves: botón **Connect** (arriba en el proyecto) para la `Project URL`; **Project Settings → API Keys** para las llaves. El código usa la `anon` y la `service_role` (pestaña **Legacy API keys**).

### 2. GitHub
```bash
cd asistencia-docentes
git init && git add . && git commit -m "Sistema de asistencia docente"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/asistencia-docentes.git
git push -u origin main
```
GitHub no acepta contraseña en `git push`: usa un token de acceso personal. El archivo `.gitignore` ya excluye `.env`; **nunca subas la `service_role key`**.

### 3. Vercel
1. **Add New → Project** → importa el repositorio.
2. En **Environment Variables** agrega:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `REPORTE_PRIVATE_KEY` (llave para firmar los reportes de horas; ver «Reportes de horas con folio y sello»)
3. Deploy. Debe ser un dominio con **HTTPS** (Vercel lo da) o la cámara no funcionará.

### 4. Desarrollo local (opcional)
```bash
cp .env.example .env.local   # llena los valores
npm install
npm run dev
```

## Actualizar una instalación que ya funciona (versión con apertura de clases y bitácora)

1. **Supabase → SQL Editor:** ejecuta `supabase/migraciones/02a-rol-apertura.sql` **solo, primero**; cuando termine, ejecuta `supabase/migraciones/02b-cambios.sql`. No borra datos y se puede repetir.
2. **Código:** copia los archivos nuevos sobre tu carpeta (reemplazando), luego:
   ```bash
   git add . && git commit -m "Apertura de clases, bitácora y edición" && git push
   ```
   Vercel publica solo al recibir el `push`.
3. **Usuarios → Dar de alta:** crea el usuario con rol *Usuario de apertura* (por ejemplo, el de la tableta de recepción).
4. **Clases y horarios:** todas las clases existentes quedan como *Presencial*. Edita las que sean en línea.

## Actualizar a la versión con reportes con folio y sello

1. **Supabase → SQL Editor:** ejecuta `supabase/migraciones/03-reportes-emitidos.sql` (no borra datos).
2. **Código:** copia los archivos sobre tu carpeta (reemplazando), `npm install` y `npm run generar-llaves`.
3. **Vercel:** agrega `REPORTE_PRIVATE_KEY` y sube el código (`git add . && git commit -m "Reportes con folio y sello" && git push`).

## Personalización

- **Colores**: `app/globals.css`, bloque `:root` al inicio (hoy son provisionales).
- **Logo**: usa el de `cuej.edu.mx`. Para tener copia propia, guárdalo como `public/logo.webp` y define `NEXT_PUBLIC_LOGO_URL=/logo.webp`.
- **Planteles**: `lib/config.ts` (`PLANTELES`).
- **Regla de pago**: función `reporte_horas` y vista `asistencias_detalle` en `supabase/migraciones/02b-cambios.sql`.
- **Ventana de entrada (30 min antes)**: función `_abrir_clase` en `supabase/migraciones/02b-cambios.sql`.
- **Intentos de contraseña permitidos** en aperturas en línea: `MAX_FALLOS` y `VENTANA_MIN` en `app/api/apertura/route.ts`.

## Privacidad

Las fotos son datos personales. Antes de operar, incluye el uso de la cámara en el aviso de privacidad para docentes
y obtén su conocimiento/consentimiento. El navegador siempre pide permiso de cámara.
Las fotos se guardan en un bucket privado y solo las ve el personal autorizado (super admin, admin y control escolar).

## Notas y pendientes recomendados

- El **pago por hora** es el vigente del profesor al emitir el reporte (queda congelado en el folio). El «Periodo» del PDF se calcula con la primera y última sesión incluidas.
- Las **faltas** se calculan con los horarios actuales; si cambias el día u horario de una clase, las faltas de fechas pasadas pueden cambiar. Revisa antes de descontar.
- Calendario de días inhábiles y suspensiones (para que no cuenten como falta).
- Cierre automático/corrección de clases «sin salida» de días anteriores.
- Validación de ubicación (geocerca) por plantel.
- Eliminar fotos pasado cierto tiempo (política de retención).
