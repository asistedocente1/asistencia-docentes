'use client';

import UserManager from '@/components/UserManager';

export default function UsuariosPage() {
  return (
    <UserManager
      title="Usuarios del sistema"
      subtitle="Solo el Super administrador da de alta y edita administradores, control escolar y usuarios de apertura de clases."
      filter={['super_admin', 'admin', 'control_escolar', 'apertura']}
      creatable={['admin', 'control_escolar', 'apertura', 'super_admin']}
    />
  );
}
