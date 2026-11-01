import { Link } from 'react-router';
import { PageHeader } from '../components/PageHeader';

export function NotFoundPage() {
  return (
    <>
      <PageHeader title="Página não encontrada" description="Este endereço não existe no painel." />
      <Link to="/" className="text-link">Voltar para a Visão Geral</Link>
    </>
  );
}
