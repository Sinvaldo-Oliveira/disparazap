import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { SessionInfo, SignupRequest } from '@disparazap/contracts';
import type { AuthApi, AuthResult, SignInInput } from './auth-api';

export type AuthState =
  | { status: 'loading' }
  | { status: 'anonymous' }
  | { status: 'authenticated'; session: SessionInfo }
  /** A API não respondeu: não dá para saber se há sessão */
  | { status: 'unavailable' };

interface AuthContextValue {
  state: AuthState;
  signIn(input: SignInInput): Promise<AuthResult>;
  signUp(input: SignupRequest): Promise<AuthResult>;
  signOut(): Promise<void>;
  /** Consulta a sessão de novo (ex.: depois de a API voltar) */
  refresh(): void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ api, children }: { api: AuthApi; children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });
    api.getSession(controller.signal).then(
      (session) => setState(session ? { status: 'authenticated', session } : { status: 'anonymous' }),
      () => {
        if (!controller.signal.aborted) setState({ status: 'unavailable' });
      },
    );
    return () => controller.abort();
  }, [api, attempt]);

  const signIn = useCallback(
    async (input: SignInInput) => {
      const result = await api.signIn(input);
      if (result.ok) setState({ status: 'authenticated', session: result.session });
      return result;
    },
    [api],
  );

  const signUp = useCallback(
    async (input: SignupRequest) => {
      const result = await api.signUp(input);
      if (result.ok) setState({ status: 'authenticated', session: result.session });
      return result;
    },
    [api],
  );

  const signOut = useCallback(async () => {
    // Antes, o painel saía da tela mesmo quando o servidor recusava o logout: a sessão continuava válida
    await api.signOut();
    setState({ status: 'anonymous' });
  }, [api]);

  const refresh = useCallback(() => setAttempt((n) => n + 1), []);

  const value = useMemo(() => ({ state, signIn, signUp, signOut, refresh }), [state, signIn, signUp, signOut, refresh]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth precisa estar dentro de <AuthProvider>');
  return value;
}

/** Sessão garantida: só use dentro de rotas protegidas por <RequireAuth> */
export function useSession(): SessionInfo {
  const { state } = useAuth();
  if (state.status !== 'authenticated') throw new Error('useSession fora de uma rota protegida');
  return state.session;
}
