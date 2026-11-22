import { LOGO_URL } from '@/lib/config';

export default function Logo({ className = '' }: { className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={LOGO_URL} alt="CUEJ · Centro Universitario de Estudios Jurídicos" className={className} />;
}
