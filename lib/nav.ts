import type { IconName } from '@/components/Icon';
import type { Role } from './types';

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  roles: Role[];
}

const STAFF: Role[] = ['super_admin', 'admin', 'control_escolar'];

export const NAV: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: 'grid', roles: STAFF },
  { href: '/mi-asistencia', label: 'Mi asistencia', icon: 'clock', roles: ['profesor'] },
  { href: '/usuarios', label: 'Usuarios', icon: 'shield', roles: ['super_admin'] },
  { href: '/profesores', label: 'Profesores', icon: 'user', roles: ['super_admin', 'admin'] },
  { href: '/clases', label: 'Clases y horarios', icon: 'book', roles: ['super_admin', 'admin'] },
  { href: '/asistencias', label: 'Asistencias', icon: 'check', roles: STAFF },
  { href: '/reportes', label: 'Reportes de horas', icon: 'chart', roles: STAFF },
];

export const navFor = (role: Role) => NAV.filter((i) => i.roles.includes(role));
