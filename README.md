# CUEJ · Sistema de asistencia docente

Next.js 14 + Supabase (base de datos, autenticación y fotos) + Vercel (despliegue). Código en GitHub.

## Roles

| Rol | Puede |
|---|---|
| **Super administrador** | Todo. Da de alta administradores, control escolar y otros super administradores. |
| **Administrador** | Da de alta profesores, asigna clases y horarios, consulta asistencias y reportes. |
| **Profesor** | Registra su entrada y salida (con foto) solo de sus clases, el día que le tocan. |
| **Control escolar** | Solo consulta (dashboard, asistencias con fotos, reportes). No puede modificar nada. |

Los permisos están protegidos en la base de datos (Row Level Security), no solo ocultos en el menú.

## Cómo funciona el registro

1. El profesor entra desde su celular y ve **solo las clases de hoy**.
2. Toca **Registrar entrada**: el navegador toma una foto sin mostrar vista previa y la sube a un bucket privado.
3. La **hora la pone el servidor** (no el celular), por lo que no se puede alterar cambiando la hora del teléfono.
4. La entrada se habilita 30 min antes del inicio de la clase y hasta que termina. Se calcula el retardo.
5. Al terminar toca **Registrar salida** (otra foto).
6. **Horas a pagar** = tiempo entre entrada y salida, sin exceder la duración programada de la clase.
7. Reportes: horas × pago por hora por profesor, retardos, clases sin salida y **faltas** (clases programadas sin registro). Exporta a CSV para Excel.

## Puesta en marcha

### 1. Supabase
1. Crea un proyecto en https://supabase.com.
2. **SQL Editor** → pega y ejecuta todo `supabase/schema.sql`.
3. **Authentication → Users → Add user**: crea tu usuario (correo y contraseña).
4. En el SQL Editor ejecuta (con tu correo) para volverte Super administrador:
   ```sql
   insert into public.profiles (id, full_name, email, role)
   select id, 'Tu nombre', email, 'super_admin' from auth.users
    where email = 'TU_CORREO@cuej.edu.mx';
   ```
5. **Project Settings → API**: copia `Project URL`, `anon key` y `service_role key`.

### 2. GitHub
```bash
cd asistencia-docentes
git init && git add . && git commit -m "Sistema de asistencia docente"
git branch -M main
git remote add origin https://github.com/TU_ORG/asistencia-docentes.git
git push -u origin main
```
El archivo `.gitignore` ya excluye `.env`; **nunca subas la `service_role key`**.

### 3. Vercel
1. **Add New → Project** → importa el repositorio.
2. En **Environment Variables** agrega:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
3. Deploy. Debe ser un dominio con **HTTPS** (Vercel lo da) o la cámara no funcionará.

### 4. Desarrollo local (opcional)
```bash
cp .env.example .env.local   # llena los valores
npm install
npm run dev
```

## Personalización

- **Colores**: `app/globals.css`, bloque `:root` al inicio (hoy son provisionales).
- **Logo**: usa el de `cuej.edu.mx`. Para tener copia propia, guárdalo como `public/logo.webp` y define `NEXT_PUBLIC_LOGO_URL=/logo.webp`.
- **Planteles**: `lib/config.ts` (`PLANTELES`).
- **Regla de pago**: función `reporte_horas` y vista `asistencias_detalle` en `schema.sql`.
- **Ventana de entrada (30 min antes)**: función `registrar_entrada` en `schema.sql`.

## Privacidad

Las fotos son datos personales. Antes de operar, incluye el uso de la cámara en el aviso de privacidad para docentes
y obtén su conocimiento/consentimiento. El navegador siempre pide permiso de cámara al docente.
Las fotos se guardan en un bucket privado y solo las ve el personal autorizado (super admin, admin y control escolar).

## Pendientes recomendados

- Calendario de días inhábiles y suspensiones (para que no cuenten como falta).
- Cierre automático/corrección de clases "sin salida".
- Validación de ubicación (geocerca) por plantel.
- Eliminar fotos pasado cierto tiempo (política de retención).
