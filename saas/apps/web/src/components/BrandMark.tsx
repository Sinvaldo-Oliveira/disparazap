// Marca do DisparaZap: balão de conversa com um raio (o "zap")
export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="9" fill="#25d366" />
      <path
        d="M16 7c-5 0-9 3.6-9 8.2 0 2.4 1.1 4.5 2.9 6L9 25l4.4-1.8c.8.2 1.7.3 2.6.3 5 0 9-3.6 9-8.3S21 7 16 7z"
        fill="#fff"
      />
      <path d="M17.4 10.2l-4.6 6.1h3l-1.2 4.6 4.6-6.1h-3z" fill="#128c7e" />
    </svg>
  );
}
