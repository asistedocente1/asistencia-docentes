import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { AuthProvider } from '@/lib/auth';

export const metadata: Metadata = {
  title: 'CUEJ · Asistencia docente',
  description: 'Sistema de registro de asistencia y horas impartidas del Centro Universitario de Estudios Jurídicos',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#17325c',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es-MX">
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
