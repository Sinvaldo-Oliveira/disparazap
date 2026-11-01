import type { ReactNode } from 'react';

export type BadgeTone = 'development' | 'success' | 'danger' | 'neutral';

export function StatusBadge({ tone, children }: { tone: BadgeTone; children: ReactNode }) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}

export function InDevelopmentBadge() {
  return <StatusBadge tone="development">Em desenvolvimento</StatusBadge>;
}
