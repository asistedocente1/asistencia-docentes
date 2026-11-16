'use client';

import UserManager from '@/components/UserManager';

export default function UsuariosPage() {
  return (
    <UserManager
      title="Usuarios del sistema"
      subtitle="Solo el Super administrador puede dar de alta administradores, control escolar y otros super administradores."
      filter={['super_admin', 'admin', 'control_escolar']}
      creatable={['admin', 'control_escolar', 'super_admin']}
    />
  );
}
