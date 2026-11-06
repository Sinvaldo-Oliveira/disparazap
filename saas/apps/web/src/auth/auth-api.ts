import {
  SESSION_PATH,
  SIGN_IN_PATH,
  SIGN_OUT_PATH,
  SIGNUP_PATH,
  problemDetailsSchema,
  sessionInfoSchema,
  type SessionInfo,
  type SignupRequest,
} from '@disparazap/contracts';

export type AuthResult = { ok: true; session: SessionInfo } | { ok: false; message: string };

export interface SignInInput {
  email: string;
  password: string;
  rememberMe: boolean;
}

/** O que o painel precisa da autenticação. Os testes trocam por uma versão falsa. */
export interface AuthApi {
  /** Sessão atual; null quando não há login. Lança erro se a API não responder. */
  getSession(signal?: AbortSignal): Promise<SessionInfo | null>;
  signIn(input: SignInInput): Promise<AuthResult>;
  signUp(input: SignupRequest): Promise<AuthResult>;
  signOut(): Promise<void>;
}

export const MESSAGES = {
  invalidCredentials: 'E-mail ou senha incorretos.',
  tooManyAttempts: 'Muitas tentativas seguidas. Aguarde um minuto e tente de novo.',
  forbidden: 'A verificação de segurança recusou o pedido. Recarregue a página e tente de novo.',
  signOutFailed: 'Não foi possível sair agora: sua sessão continua ativa. Recarregue a página e tente de novo.',
  offline: 'Não foi possível falar com o servidor. Verifique sua conexão e tente de novo.',
  generic: 'Não foi possível concluir agora. Tente de novo em instantes.',
} as const;

const JSON_HEADERS = { 'content-type': 'application/json', accept: 'application/json' };

async function problemDetail(response: Response): Promise<string | undefined> {
  try {
    return problemDetailsSchema.parse(await response.json()).detail;
  } catch {
    return undefined;
  }
}

// Mesma origem: o navegador envia o cookie de sessão sozinho; o token nunca passa pelo JavaScript
export const httpAuthApi: AuthApi = {
  async getSession(signal) {
    const response = await fetch(SESSION_PATH, { signal, headers: { accept: 'application/json' }, credentials: 'same-origin' });
    if (response.status === 401) return null;
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return sessionInfoSchema.parse(await response.json());
  },

  async signIn(input) {
    let response: Response;
    try {
      response = await fetch(SIGN_IN_PATH, { method: 'POST', headers: JSON_HEADERS, credentials: 'same-origin', body: JSON.stringify(input) });
    } catch {
      return { ok: false, message: MESSAGES.offline };
    }
    if (response.ok) {
      const session = await httpAuthApi.getSession().catch(() => null);
      return session ? { ok: true, session } : { ok: false, message: MESSAGES.generic };
    }
    if (response.status === 401) return { ok: false, message: MESSAGES.invalidCredentials };
    if (response.status === 429) return { ok: false, message: MESSAGES.tooManyAttempts };
    if (response.status === 403) return { ok: false, message: MESSAGES.forbidden };
    return { ok: false, message: MESSAGES.generic };
  },

  async signUp(input) {
    let response: Response;
    try {
      response = await fetch(SIGNUP_PATH, { method: 'POST', headers: JSON_HEADERS, credentials: 'same-origin', body: JSON.stringify(input) });
    } catch {
      return { ok: false, message: MESSAGES.offline };
    }
    if (response.status === 201) return { ok: true, session: sessionInfoSchema.parse(await response.json()) };
    if (response.status === 429) return { ok: false, message: MESSAGES.tooManyAttempts };
    if (response.status === 400 || response.status === 403 || response.status === 409) {
      return { ok: false, message: (await problemDetail(response)) ?? MESSAGES.generic };
    }
    return { ok: false, message: MESSAGES.generic };
  },

  async signOut() {
    let response: Response;
    try {
      response = await fetch(SIGN_OUT_PATH, { method: 'POST', headers: JSON_HEADERS, credentials: 'same-origin', body: '{}' });
    } catch {
      throw new Error(MESSAGES.signOutFailed);
    }
    // Sem confirmação do servidor a sessão continua válida: não dá para dizer que saiu
    if (!response.ok) throw new Error(MESSAGES.signOutFailed);
  },
};
