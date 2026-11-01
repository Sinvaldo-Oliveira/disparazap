import type { ReactNode } from 'react';

export function Card({ title, children, className = '' }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`.trim()}>
      <h2 className="card__title">{title}</h2>
      {children}
    </section>
  );
}
