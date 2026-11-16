export type Role = 'super_admin' | 'admin' | 'profesor' | 'control_escolar';

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
