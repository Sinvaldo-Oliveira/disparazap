import { Construction } from 'lucide-react';

// Estado padrão de módulo não implementado: diz o que virá e quando, sem simular dados ou ações
export function UnderConstruction({ summary, plannedFor }: { summary: string; plannedFor: string }) {
  return (
    <section className="under-construction" aria-labelledby="under-construction-title">
      <Construction className="under-construction__icon" aria-hidden="true" />
      <h2 id="under-construction-title">Este módulo ainda não foi implementado</h2>
      <p>Nada nesta tela funciona por enquanto: não há dados nem ações disponíveis.</p>
      <dl className="under-construction__facts">
        <div>
          <dt>Previsto</dt>
          <dd>{summary}</dd>
        </div>
        <div>
          <dt>Quando</dt>
          <dd>{plannedFor}</dd>
        </div>
      </dl>
    </section>
  );
}
