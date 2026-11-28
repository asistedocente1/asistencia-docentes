import type { Modalidad, Role } from './types';

export const TZ = 'America/Mexico_City';

// Logo oficial tomado de la página principal de cuej.edu.mx.
// Para usar una copia propia: guarda el archivo en /public/logo.webp y define NEXT_PUBLIC_LOGO_URL=/logo.webp
export const LOGO_URL =
  process.env.NEXT_PUBLIC_LOGO_URL ||
  'https://cuej.edu.mx/wp-content/uploads/2024/04/CUEJ-LOGO-1024x464.webp';

export const REQUIRE_PHOTO = process.env.NEXT_PUBLIC_REQUIRE_PHOTO !== 'false';

export const PLANTELES = ['Ciudad de México', 'Veracruz', 'Manzanillo', 'Ameyalli (Toluca)'];

export const DIAS = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

export const MODALIDAD_LABEL: Record<Modalidad, string> = {
  presencial: 'Presencial',
  en_linea: 'En línea',
};

export const ROLE_LABEL: Record<Role, string> = {
  super_admin: 'Super administrador',
  admin: 'Administrador',
  profesor: 'Profesor',
  control_escolar: 'Control escolar',
  apertura: 'Usuario de apertura',
};

export const defaultPath = (role: Role) => {
  if (role === 'profesor') return '/mi-asistencia';
  if (role === 'apertura') return '/apertura';
  return '/dashboard';
};

/** Tolerancia de retardo (min). Debe coincidir con la función tolerancia_min() de la base de datos. */
export const TOLERANCIA_MIN = 10;
