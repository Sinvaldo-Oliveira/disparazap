import { LoaderCircle, ServerOff } from 'lucide-react';
import { Navigate, Outlet, useLocation, useSearchParams } from 'react-router';
import { useAuth } from './AuthProvider';

export const LOGIN_PATH = '/entrar';
export const SIGNUP_ROUTE = '/cadastro';

/** Só caminhos internos do painel: evita redirecionar para outro site depois do login */
export function safeReturnPath(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return '/';
  if (value === LOGIN_PATH || value === SIGNUP_ROUTE) return '/';
  return value;
}

function CheckingSession() {
  return (
    <div className="auth-status" role="status">
      <LoaderCircle className="auth-status__icon auth-status__icon--spin" aria-hidden="true" />
      <p>Verificando sua sessão…</p>
    </div>
  );
}

function ServerUnavailable({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="auth-status" role="alert">
      <ServerOff className="auth-status__icon" aria-hidden="true" />
      <h1>Servidor indisponível</h1>
      <p>Não foi possível verificar sua sessão. Confira se a API está ligada e tente de novo.</p>
      <button type="button" className="auth-button auth-button--small" onClick={onRetry}>
        Tentar novamente
      </button>
    </div>
  );
}

/** Rotas do painel: exigem login. Sem sessão, vai para /entrar e volta depois. */
export function RequireAuth() {
  const { state, refresh } = useAuth();
  const location = useLocation();

  if (state.status === 'loading') return <CheckingSession />;
  if (state.status === 'unavailable') return <ServerUnavailable onRetry={refresh} />;
  if (state.status === 'anonymous') {
    const back = `${location.pathname}${location.search}`;
    const search = back === '/' ? '' : `?voltar=${encodeURIComponent(back)}`;
    return <Navigate to={`${LOGIN_PATH}${search}`} replace />;
  }
  return <Outlet />;
}

/** Telas de entrar e criar conta: quem já está logado vai direto para o painel */
export function PublicOnly() {
  const { state } = useAuth();
  const [params] = useSearchParams();
  if (state.status === 'loading') return <CheckingSession />;
  if (state.status === 'authenticated') return <Navigate to={safeReturnPath(params.get('voltar'))} replace />;
  return <Outlet />;
}
