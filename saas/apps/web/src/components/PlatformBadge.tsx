import { ZERNIO_PLATFORMS, ZERNIO_PLATFORM_LABELS, type ZernioPlatform } from '@disparazap/contracts';

// Selo de cada rede: letras e cor, sem logotipo nem imagem externa (a política de conteúdo só permite a própria origem)
const PLATFORM_BADGES: Readonly<Record<ZernioPlatform, string>> = {
  instagram: 'IG',
  facebook: 'f',
  tiktok: 'TT',
  linkedin: 'in',
  youtube: 'YT',
  threads: '@',
  pinterest: 'P',
  googlebusiness: 'G',
  twitter: 'X',
};

export const isKnownPlatform = (platform: string): platform is ZernioPlatform => (ZERNIO_PLATFORMS as readonly string[]).includes(platform);
export const platformLabel = (platform: string) => (isKnownPlatform(platform) ? ZERNIO_PLATFORM_LABELS[platform] : platform);

export function PlatformBadge({ platform, small = false }: { platform: string; small?: boolean }) {
  const known = isKnownPlatform(platform);
  return (
    <span className={`platform-badge platform-badge--${known ? platform : 'other'}${small ? ' platform-badge--small' : ''}`} aria-hidden="true">
      {known ? PLATFORM_BADGES[platform] : platform.slice(0, 2).toUpperCase()}
    </span>
  );
}
