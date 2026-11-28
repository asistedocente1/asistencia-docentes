/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Evita que el navegador cachee la API de usuarios
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [{ key: 'Cache-Control', value: 'no-store' }],
      },
      {
        // La cámara solo puede usarse desde este mismo sitio
        source: '/:path*',
        headers: [{ key: 'Permissions-Policy', value: 'camera=(self), geolocation=(self)' }],
      },
    ];
  },
};

export default nextConfig;
