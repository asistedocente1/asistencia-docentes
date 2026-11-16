'use client';

import UserManager from '@/components/UserManager';

export default function ProfesoresPage() {
  return (
    <UserManager
      title="Profesores"
      subtitle="Da de alta a los docentes y define su pago por hora. Después asígnales sus clases en “Clases y horarios”."
      filter={['profesor']}
      creatable={['profesor']}
    />
  );
}
