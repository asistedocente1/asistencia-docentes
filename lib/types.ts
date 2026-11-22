export type Role = 'super_admin' | 'admin' | 'profesor' | 'control_escolar' | 'apertura';

export type Modalidad = 'presencial' | 'en_linea';

export interface Profile {
  id: string;
  full_name: string;
  email: string;
  role: Role;
  active: boolean;
  hourly_rate: number;
}

export interface Clase {
  id: string;
  profesor_id: string;
  materia: string;
  grupo: string;
  plantel: string;
  dia_semana: number;
  hora_inicio: string;
  hora_fin: string;
  modalidad: Modalidad;
  activo: boolean;
  profiles?: { full_name: string } | null;
}

export interface Asistencia {
  id: string;
  clase_id: string;
  fecha: string;
  entrada: string;
  salida: string | null;
  retardo_min: number;
}

export interface AsistenciaDetalle {
  id: string;
  fecha: string;
  profesor_id: string;
  profesor_nombre: string;
  hourly_rate: number;
  materia: string;
  grupo: string;
  plantel: string;
  hora_inicio: string;
  hora_fin: string;
  entrada: string;
  salida: string | null;
  retardo_min: number;
  foto_entrada: string | null;
  foto_salida: string | null;
  minutos_programados: number;
  minutos_trabajados: number | null;
  minutos_pagables: number | null;
  modalidad: Modalidad | null;
  abierta_por_nombre: string | null;
  cerrada_por_nombre: string | null;
}

export interface ReporteHoras {
  profesor_id: string;
  profesor_nombre: string;
  hourly_rate: number;
  clases_impartidas: number;
  retardos: number;
  sin_salida: number;
  minutos_pagables: number;
}

export interface Falta {
  fecha: string;
  profesor_id: string;
  profesor_nombre: string;
  materia: string;
  grupo: string;
  plantel: string;
  hora_inicio: string;
  hora_fin: string;
}

/** Fila de public.apertura_del_dia() */
export interface AperturaRow {
  clase_id: string;
  materia: string;
  grupo: string;
  plantel: string;
  modalidad: Modalidad;
  hora_inicio: string;
  hora_fin: string;
  profesor_id: string;
  profesor_nombre: string;
  asistencia_id: string | null;
  entrada: string | null;
  salida: string | null;
  retardo_min: number | null;
  ahora: string; // hora del servidor (HH:MM:SS, hora de Ciudad de México)
}

export interface BitacoraRow {
  id: number;
  created_at: string;
  actor_id: string | null;
  actor_nombre: string | null;
  actor_rol: string | null;
  accion: string;
  entidad: string | null;
  entidad_id: string | null;
  resumen: string | null;
  detalle: Record<string, unknown> | null;
}
