import { useEffect, useState } from 'react';
import { BrandMark } from './BrandMark';

// Mensagens verdadeiras sobre o produto: nada de números, clientes ou resultados inventados
export const SHOWCASE_SLIDES = [
  {
    title: 'Um painel para os seus disparos',
    text: 'Contatos, mensagens e campanhas da sua empresa reunidos em um só lugar, módulo a módulo.',
  },
  {
    title: 'Cada empresa no seu espaço',
    text: 'Os dados de cada empresa ficam separados, e cada pessoa entra com a própria conta e senha.',
  },
  {
    title: 'Pensado para o MyLinksss',
    text: 'A integração com o MyLinksss está planejada para que você use a mesma conta nos dois sistemas.',
  },
] as const;

const ROTATION_MS = 7000;
const MENU = ['Visão Geral', 'WhatsApp', 'Campanhas', 'Contatos', 'Automações', 'Integrações'];

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// Ilustração decorativa do painel: só formas e nomes de menu, sem dados
function PanelIllustration() {
  return (
    <div className="showcase__device" aria-hidden="true">
      <div className="showcase__sidebar">
        <div className="showcase__brand">
          <BrandMark size={20} />
          <span>DisparaZap</span>
        </div>
        {MENU.map((item, index) => (
          <div key={item} className={`showcase__menu-item${index === 2 ? ' showcase__menu-item--active' : ''}`}>
            <span className="showcase__dot" />
            {item}
          </div>
        ))}
      </div>
      <div className="showcase__main">
        <div className="showcase__crumb">Campanhas</div>
        <div className="showcase__cards">
          {[0, 1, 2].map((card) => (
            <div key={card} className="showcase__card">
              <span className="showcase__line showcase__line--short" />
              <span className="showcase__line" />
              <span className="showcase__line showcase__line--muted" />
            </div>
          ))}
        </div>
        <div className="showcase__chart">
          <span className="showcase__line showcase__line--short" />
          <svg viewBox="0 0 400 120" preserveAspectRatio="none" className="showcase__chart-svg">
            <path d="M0 95 C 50 80, 80 40, 130 55 S 210 100, 260 60 S 340 20, 400 35" fill="none" stroke="#25d366" strokeWidth="3" />
            <path d="M0 105 C 60 100, 90 75, 140 82 S 220 95, 270 85 S 350 60, 400 70" fill="none" stroke="#a3b1ad" strokeWidth="2" strokeDasharray="6 6" />
          </svg>
        </div>
        <div className="showcase__list">
          {[0, 1].map((row) => (
            <div key={row} className="showcase__row">
              <span className="showcase__avatar" />
              <span className="showcase__line" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function AuthShowcase() {
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    if (prefersReducedMotion()) return;
    const timer = setInterval(() => setCurrent((index) => (index + 1) % SHOWCASE_SLIDES.length), ROTATION_MS);
    return () => clearInterval(timer);
  }, []);

  const slide = SHOWCASE_SLIDES[current] ?? SHOWCASE_SLIDES[0];

  return (
    <section className="showcase" aria-label="Sobre o DisparaZap">
      <div className="showcase__copy" aria-live="polite">
        <h2 className="showcase__title">{slide.title}</h2>
        <p className="showcase__text">{slide.text}</p>
      </div>
      <div className="showcase__dots">
        {SHOWCASE_SLIDES.map((item, index) => (
          <button
            key={item.title}
            type="button"
            className={`showcase__pager${index === current ? ' showcase__pager--active' : ''}`}
            aria-label={`Mostrar mensagem ${index + 1} de ${SHOWCASE_SLIDES.length}`}
            aria-current={index === current ? 'true' : undefined}
            onClick={() => setCurrent(index)}
          />
        ))}
      </div>
      <PanelIllustration />
    </section>
  );
}
