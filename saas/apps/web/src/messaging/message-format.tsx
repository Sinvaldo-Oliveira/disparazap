import type { ReactNode } from 'react';

/** Sem nome, remove o {nome} junto com o espaço anterior ("Olá {nome}!" → "Olá!"), como no disparador atual */
export function renderMessage(template: string, name: string): string {
  return name ? template.replace(/\{nome\}/gi, name) : template.replace(/ ?\{nome\}/gi, '');
}

// Links (como o WhatsApp destaca), *negrito*, _itálico_ e ~riscado~, montados como elementos (nada de HTML vindo de texto)
const WHATSAPP_STYLE_RE = /(https?:\/\/[^\s]+)|\*([^*\n]+)\*|(?<=^|[\s(])_([^_\n]+)_(?=$|[\s).,!?])|~([^~\n]+)~/m;

export function formatWhatsApp(text: string, keyPrefix = 'f'): ReactNode[] {
  const nodes: ReactNode[] = [];
  let rest = text;
  let index = 0;
  while (rest) {
    const match = WHATSAPP_STYLE_RE.exec(rest);
    if (!match) {
      nodes.push(rest);
      break;
    }
    if (match.index > 0) nodes.push(rest.slice(0, match.index));
    const key = `${keyPrefix}-${index++}`;
    // Link só destacado, sem virar <a>: a pré-visualização não navega
    if (match[1] !== undefined) nodes.push(<span key={key} className="wa-link">{match[1]}</span>);
    else if (match[2] !== undefined) nodes.push(<strong key={key}>{formatWhatsApp(match[2], key)}</strong>);
    else if (match[3] !== undefined) nodes.push(<em key={key}>{formatWhatsApp(match[3], key)}</em>);
    else nodes.push(<s key={key}>{formatWhatsApp(match[4] ?? '', key)}</s>);
    rest = rest.slice(match.index + match[0].length);
  }
  return nodes;
}

export const randomBetween = (min: number, max: number, random: () => number = Math.random) => Math.floor(min + random() * (max - min + 1));

export const formatSeconds = (value: number) => `${Number.isInteger(value) ? value : value.toFixed(1)}s`;

/** 125000 → "02:05"; 3725000 → "1:02:05" */
export function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export function humanDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} segundos`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}
