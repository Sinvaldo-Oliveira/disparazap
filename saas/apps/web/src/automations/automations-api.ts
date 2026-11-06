import {
  automationActivityPath,
  automationActivitySchema,
  type AutomationActivity,
  AUTOMATIONS_COMMENT_PATH,
  AUTOMATIONS_FLOWS_PATH,
  AUTOMATIONS_FLOW_QUESTION_PATH,
  AUTOMATIONS_OVERVIEW_PATH,
  automationDetailPath,
  automationDetailSchema,
  automationFlowPath,
  automationFlowQrPath,
  automationFlowStatePath,
  automationsOverviewSchema,
  automationStatePath,
  flowSummarySchema,
  flowQrSchema,
  flowsListSchema,
  type AutomationDetail,
  type AutomationInput,
  type AutomationsOverview,
  type AutomationUpdate,
  type FlowInput,
  type FlowQr,
  type FlowsList,
  type QuestionFlowInput,
  type FlowSummary,
} from '@disparazap/contracts';
import { request, type ApiResult } from '../platform/platform-api';

/**
 * Automações de redes pela Zernio (PLANO_MODULO_AUTOMACOES). O painel fala só com a API do DisparaZap, nunca com a
 * Zernio. A1: consulta; A2: criar (sempre pausada), alterar, ativar, pausar e excluir; A5: fluxos de link (pausados).
 * Os testes trocam esta interface.
 */
export interface AutomationsApi {
  overview(signal?: AbortSignal): Promise<ApiResult<AutomationsOverview>>;
  detail(id: string, signal?: AbortSignal): Promise<ApiResult<AutomationDetail>>;
  create(input: AutomationInput): Promise<ApiResult<AutomationDetail>>;
  update(id: string, input: AutomationUpdate): Promise<ApiResult<AutomationDetail>>;
  setState(id: string, active: boolean): Promise<ApiResult<AutomationDetail>>;
  remove(id: string): Promise<ApiResult<null>>;
  flows(signal?: AbortSignal): Promise<ApiResult<FlowsList>>;
  createFlow(input: FlowInput): Promise<ApiResult<FlowSummary>>;
  setFlowState(id: string, active: boolean): Promise<ApiResult<FlowSummary>>;
  removeFlow(id: string): Promise<ApiResult<null>>;
  flowQr(id: string): Promise<ApiResult<FlowQr>>;
  createQuestionFlow(input: QuestionFlowInput): Promise<ApiResult<FlowSummary>>;
  activity(id: string, signal?: AbortSignal): Promise<ApiResult<AutomationActivity>>;
}

const withSignal = (signal?: AbortSignal) => (signal ? { signal } : {});
const parseDetail = (body: unknown) => automationDetailSchema.parse(body);
const parseFlow = (body: unknown) => flowSummarySchema.parse(body);

export const httpAutomationsApi: AutomationsApi = {
  overview: (signal) => request(AUTOMATIONS_OVERVIEW_PATH, { method: 'GET', ...withSignal(signal) }, (body) => automationsOverviewSchema.parse(body)),
  detail: (id, signal) => request(automationDetailPath(id), { method: 'GET', ...withSignal(signal) }, parseDetail),
  create: (input) => request(AUTOMATIONS_COMMENT_PATH, { method: 'POST', body: JSON.stringify(input) }, parseDetail),
  update: (id, input) => request(automationDetailPath(id), { method: 'PUT', body: JSON.stringify(input) }, parseDetail),
  setState: (id, active) => request(automationStatePath(id), { method: 'POST', body: JSON.stringify({ active }) }, parseDetail),
  remove: (id) => request(automationDetailPath(id), { method: 'DELETE' }, () => null),
  flows: (signal) => request(AUTOMATIONS_FLOWS_PATH, { method: 'GET', ...withSignal(signal) }, (body) => flowsListSchema.parse(body)),
  createFlow: (input) => request(AUTOMATIONS_FLOWS_PATH, { method: 'POST', body: JSON.stringify(input) }, parseFlow),
  setFlowState: (id, active) => request(automationFlowStatePath(id), { method: 'POST', body: JSON.stringify({ active }) }, parseFlow),
  removeFlow: (id) => request(automationFlowPath(id), { method: 'DELETE' }, () => null),
  flowQr: (id) => request(automationFlowQrPath(id), { method: 'GET' }, (body) => flowQrSchema.parse(body)),
  createQuestionFlow: (input) => request(AUTOMATIONS_FLOW_QUESTION_PATH, { method: 'POST', body: JSON.stringify(input) }, parseFlow),
  activity: (id, signal) => request(automationActivityPath(id), { method: 'GET', ...withSignal(signal) }, (body) => automationActivitySchema.parse(body)),
};
