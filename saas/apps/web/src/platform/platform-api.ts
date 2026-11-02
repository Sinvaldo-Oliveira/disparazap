import {
  EVOLUTION_SETTINGS_PATH,
  EVOLUTION_TEST_PATH,
  evolutionSettingsSchema,
  evolutionTestResultSchema,
  problemDetailsSchema,
  type EvolutionSettings,
  type EvolutionSettingsInput,
  type EvolutionTestResult,
} from '@disparazap/contracts';

/** Falha: mensagem para a tela e o código HTTP (0 = API fora do ar) */
export type ApiResult<T> = { ok: true; data: T } | { ok: false; message: string; status: number };

/** Configurações da plataforma (Super-Admin). Os testes trocam por uma versão falsa. */
export interface PlatformApi {
  getEvolutionSettings(signal?: AbortSignal): Promise<ApiResult<EvolutionSettings>>;
  saveEvolutionSettings(input: EvolutionSettingsInput): Promise<ApiResult<EvolutionSettings>>;
  testEvolution(): Promise<ApiResult<EvolutionTestResult>>;
}

const OFFLINE = 'Não foi possível falar com o servidor. Verifique se a API está ligada.';
const GENERIC = 'Não foi possível concluir agora. Tente de novo em instantes.';

export async function request<T>(path: string, init: RequestInit, parse: (body: unknown) => T, contentType = 'application/json'): Promise<ApiResult<T>> {
  let response: Response;
  try {
    // content-type só quando há corpo: o Fastify recusa JSON vazio (ex.: DELETE sem corpo)
    const headers: Record<string, string> = { accept: 'application/json' };
    if (init.body !== undefined) headers['content-type'] = contentType;
    response = await fetch(path, { credentials: 'same-origin', ...init, headers });
  } catch {
    return { ok: false, message: OFFLINE, status: 0 };
  }
  if (response.ok) {
    try {
      // 204: sucesso sem corpo (ex.: exclusão)
      return { ok: true, data: parse(response.status === 204 ? null : await response.json()) };
    } catch {
      return { ok: false, message: GENERIC, status: response.status };
    }
  }
  try {
    const detail = problemDetailsSchema.parse(await response.json()).detail;
    return { ok: false, message: detail ?? GENERIC, status: response.status };
  } catch {
    return { ok: false, message: GENERIC, status: response.status };
  }
}

export const httpPlatformApi: PlatformApi = {
  getEvolutionSettings: (signal) => request(EVOLUTION_SETTINGS_PATH, { method: 'GET', ...(signal ? { signal } : {}) }, (body) => evolutionSettingsSchema.parse(body)),
  saveEvolutionSettings: (input) => request(EVOLUTION_SETTINGS_PATH, { method: 'PUT', body: JSON.stringify(input) }, (body) => evolutionSettingsSchema.parse(body)),
  testEvolution: () => request(EVOLUTION_TEST_PATH, { method: 'POST', body: '{}' }, (body) => evolutionTestResultSchema.parse(body)),
};
