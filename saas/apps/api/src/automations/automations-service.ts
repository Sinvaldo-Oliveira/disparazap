import {
  automationCapability,
  automationInputProblem,
  automationInputSchema,
  automationStateInputSchema,
  automationUpdateSchema,
  flowInputSchema,
  questionFlowInputSchema,
  type QuestionFlowInput,
  type AutomationAccount,
  type AutomationActivity,
  type AutomationCapability,
  type AutomationDetail,
  type AutomationSummary,
  type AutomationUpdate,
  type AutomationsOverview,
  type FlowInput,
  type FlowSummary,
  type FlowsList,
  type FlowQr,
  type ZernioAccount,
} from '@disparazap/contracts';
import QRCode from 'qrcode';
import type { z } from 'zod';
import { canManage, type Member } from '../auth/member.ts';
import {
  ZernioError,
  type ZernioClient,
  type ZernioCommentAutomation,
  type ZernioCommentAutomationBody,
  type ZernioWorkflow,
  type ZernioWorkflowBody,
} from '../integrations/zernio-client.ts';
import { fromZernio, readAccounts, readyClient, ZernioServiceError, type ConnectionRow, type ZernioContext } from '../zernio/zernio-service.ts';

/**
 * Automações de redes pela Zernio (PLANO_MODULO_AUTOMACOES; A1 consulta, A2 Comentário → DM e → resposta pública).
 * - A Zernio guarda as automações: nada é copiado para o banco do DisparaZap (D-65).
 * - A empresa vem da sessão; a chave é a da empresa (cofre) e o perfil é o da empresa.
 * - Só existem, para a empresa, automações cuja conta é do perfil dela, relido na Zernio a cada pedido (senão, 404).
 * - Alterar exige dono ou administrador e a trava AUTOMATIONS_WRITE_ENABLED. Toda automação nasce pausada.
 * - Erros só como mensagens fixas. Textos de DM e de resposta nunca vão para o log.
 */

const NOT_FOUND = 'Automação não encontrada nesta empresa.';
const ACCOUNT_NOT_FOUND = 'Conta não encontrada nesta empresa.';
const MANAGERS_ONLY = 'Só o dono e os administradores da empresa criam, alteram, ativam e excluem automações.';
const WRITE_DISABLED = 'Criar, alterar, ativar e excluir automações está desligado nesta plataforma até a homologação.';
const DUPLICATE_NAME = 'Já existe uma automação com este nome nesta conta. Use outro nome.';
const ZERNIO_INVALID = 'A Zernio recusou os dados da automação. Confira o texto, os botões e as palavras-chave.';
const POST_TAKEN = 'Já existe uma automação ativa para esta publicação.';
const UNCERTAIN = 'Não foi possível confirmar se a Zernio concluiu o pedido. Atualize a lista e confira antes de tentar de novo.';
const BAD_INPUT = 'Dados da automação inválidos. Recarregue a página e tente de novo.';
const TRIGGER_FIXED = 'O que dispara a automação não muda depois de criada. Para outro gatilho, crie outra automação.';
const FOREIGN_TRIGGER = 'Esta automação foi criada no painel da Zernio com um gatilho que o DisparaZap ainda não edita. Altere-a no painel da Zernio.';
const ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;

async function scope(ctx: ZernioContext, member: Member) {
  const { row, client } = await readyClient(ctx, member);
  try {
    const accounts = await readAccounts(client, row);
    return { row, client, accounts };
  } catch (err) {
    return fromZernio(ctx, row, err, { leitura: 'automacoes.contas' });
  }
}

const accountName = (account: ZernioAccount) => (account.username ? `@${account.username}` : (account.displayName ?? account.platform));

function toAccount(account: ZernioAccount): AutomationAccount {
  return { id: account.id, platform: account.platform, name: accountName(account), capability: automationCapability(account.platform) };
}

function toSummary(item: ZernioCommentAutomation, account: ZernioAccount): AutomationSummary {
  // A rede é a da conta do perfil (relida agora), nunca a que veio na automação
  const publicReplyOnly = automationCapability(account.platform) === 'public_reply';
  return {
    id: item.id,
    kind: 'comment',
    name: item.name || 'Automação sem nome',
    platform: account.platform,
    accountId: account.id,
    accountName: accountName(account),
    trigger: item.trigger,
    keywords: item.keywords,
    matchMode: item.matchMode,
    postBound: item.platformPostId !== null,
    postTitle: item.postTitle,
    isActive: item.isActive,
    repeat: { mode: item.repeatMode, cooldownHours: item.cooldownHours },
    followersOnly: item.followersOnly,
    hasDm: !publicReplyOnly && Boolean(item.dmMessage),
    hasPublicReply: Boolean(item.commentReply),
    stats: item.stats,
    createdAt: item.createdAt,
  };
}

function toDetail(item: ZernioCommentAutomation, account: ZernioAccount, member: Member, writeEnabled: boolean): AutomationDetail {
  const summary = toSummary(item, account);
  return {
    automation: summary,
    writeEnabled,
    canManage: canManage(member),
    dmMessage: summary.hasDm ? item.dmMessage : null,
    buttons: summary.hasDm ? item.buttons : [],
    commentReply: item.commentReply,
    publicReplyPolicy: item.publicReplyPolicy,
    alsoMatchInDms: item.alsoMatchInDms,
    followGate: summary.followersOnly ? item.followGate : null,
  };
}

/** Conta da automação, se for do perfil da empresa (senão, undefined: a automação não existe para esta empresa) */
function ownAccount(accounts: readonly ZernioAccount[], item: ZernioCommentAutomation): ZernioAccount | undefined {
  return item.accountId ? accounts.find((account) => account.id === item.accountId) : undefined;
}

function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (parsed.success) return parsed.data;
  // As mensagens dos campos são as do contrato (em português); estrutura errada recebe a mensagem geral
  const issue = parsed.error.issues[0];
  throw new ZernioServiceError(400, issue && issue.code !== 'invalid_type' && issue.code !== 'unrecognized_keys' ? issue.message : BAD_INPUT);
}

function requireWriter(member: Member, writeEnabled: boolean) {
  if (!canManage(member)) throw new ZernioServiceError(403, MANAGERS_ONLY);
  if (!writeEnabled) throw new ZernioServiceError(409, WRITE_DISABLED);
}

const sameName = (a: string, b: string) => a.trim().toLocaleLowerCase('pt-BR') === b.trim().toLocaleLowerCase('pt-BR');

/** Palavras-chave sem repetição (maiúsculas e minúsculas contam como a mesma) */
function uniqueKeywords(keywords: readonly string[]): string[] {
  const seen = new Set<string>();
  return keywords.filter((keyword) => {
    const key = keyword.toLocaleLowerCase('pt-BR');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Corpo para a Zernio, só com os campos documentados para a rede (alsoMatchInDms sempre false: decisão A4).
 * previous = a automação antes da edição: se ela era "só seguidores" e deixou de ser, a verificação é desligada.
 */
function zernioBody(input: AutomationUpdate, capability: AutomationCapability, previous: ZernioCommentAutomation | null = null): ZernioCommentAutomationBody {
  const repeatPolicy: ZernioCommentAutomationBody['repeatPolicy'] =
    input.repeat.mode === 'every_comment' && input.repeat.cooldownHours ? { mode: 'every_comment', cooldownHours: input.repeat.cooldownHours } : { mode: 'once' };
  const buttons = input.buttons.map((button) => ({ type: 'url' as const, title: button.title, url: button.url }));
  if (input.trigger === 'story_mention') {
    // Menção em story (A3, só Instagram): sem palavra-chave, sem postagem e sem resposta pública
    return { name: input.name, trigger: 'story_mention', keywords: [], repeatPolicy, dmMessage: input.dmMessage ?? '', buttons, alsoMatchInDms: false };
  }
  const base: ZernioCommentAutomationBody = { name: input.name, trigger: 'comment', keywords: uniqueKeywords(input.keywords), matchMode: input.matchMode, repeatPolicy };
  if (capability === 'public_reply') return { ...base, commentReply: input.commentReply ?? '' };
  const body: ZernioCommentAutomationBody = {
    ...base,
    dmMessage: input.dmMessage ?? '',
    buttons,
    commentReply: input.commentReply || null,
    // Só seguidores: a resposta pública sai mesmo enquanto a DM espera a confirmação (padrão da Zernio para esse modelo)
    publicReplyPolicy: input.followGate ? 'always' : 'after_dm',
    alsoMatchInDms: false,
  };
  if (input.followGate) return { ...body, audience: { followerStatus: 'follower', whenUnknown: 'verify' }, followGate: { ...input.followGate } };
  if (previous?.followersOnly) return { ...body, audience: { followerStatus: 'any', whenUnknown: 'send' } };
  return body;
}

/** Erro na escrita: recusa definida vira mensagem fixa; resultado incerto pede para conferir a lista antes de repetir */
async function writeFailure(ctx: ZernioContext, row: ConnectionRow, err: unknown, acao: string): Promise<never> {
  if (err instanceof ZernioError) {
    const diagnostic = { escrita: acao, tipo: err.kind, status: err.httpStatus, codigo: err.code };
    if (err.kind === 'invalid') throw new ZernioServiceError(400, ZERNIO_INVALID, diagnostic);
    if (err.kind === 'conflict') throw new ZernioServiceError(409, POST_TAKEN, diagnostic);
    if (err.kind === 'not_found') throw new ZernioServiceError(404, NOT_FOUND, diagnostic);
    if (err.kind === 'unreachable' || err.kind === 'failed') throw new ZernioServiceError(502, UNCERTAIN, diagnostic);
  }
  return fromZernio(ctx, row, err, { escrita: acao });
}

async function listOwn(ctx: ZernioContext, row: ConnectionRow, client: ZernioClient, accounts: readonly ZernioAccount[]) {
  let items: ZernioCommentAutomation[];
  try {
    items = await client.listCommentAutomations(row.profileId);
  } catch (err) {
    return fromZernio(ctx, row, err, { leitura: 'automacoes.lista' });
  }
  return items.flatMap((item) => {
    const account = ownAccount(accounts, item);
    return account ? [{ item, account }] : [];
  });
}

/** Automação da empresa (lida agora na Zernio) ou 404 */
async function loadOwn(ctx: ZernioContext, member: Member, automationId: string) {
  if (!ID_PATTERN.test(automationId)) throw new ZernioServiceError(404, NOT_FOUND);
  const { row, client, accounts } = await scope(ctx, member);
  let item: ZernioCommentAutomation;
  try {
    item = await client.getCommentAutomation(automationId);
  } catch (err) {
    if (err instanceof ZernioError && err.kind === 'not_found') throw new ZernioServiceError(404, NOT_FOUND);
    return fromZernio(ctx, row, err, { leitura: 'automacoes.detalhe' });
  }
  const account = ownAccount(accounts, item);
  if (!account) throw new ZernioServiceError(404, NOT_FOUND);
  return { row, client, accounts, item, account };
}

// ----- Leitura (A1) -----

export async function automationsOverview(ctx: ZernioContext, member: Member, writeEnabled: boolean): Promise<AutomationsOverview> {
  const { row, client, accounts } = await scope(ctx, member);
  const automations = (await listOwn(ctx, row, client, accounts)).map(({ item, account }) => toSummary(item, account));
  return {
    accounts: accounts.map(toAccount),
    automations,
    totals: {
      active: automations.filter((item) => item.isActive).length,
      dmsSent: automations.reduce((sum, item) => sum + item.stats.dmsSent, 0),
      linkClicks: automations.reduce((sum, item) => sum + item.stats.linkClicks, 0),
    },
    writeEnabled,
    canManage: canManage(member),
  };
}

export async function automationDetail(ctx: ZernioContext, member: Member, automationId: string, writeEnabled: boolean): Promise<AutomationDetail> {
  const { item, account } = await loadOwn(ctx, member, automationId);
  return toDetail(item, account, member, writeEnabled);
}

// ----- Escrita (A2) -----

export async function createAutomation(ctx: ZernioContext, member: Member, body: unknown, writeEnabled: boolean): Promise<AutomationDetail> {
  requireWriter(member, writeEnabled);
  const input = parseBody(automationInputSchema, body);
  const { row, client, accounts } = await scope(ctx, member);
  const account = accounts.find((item) => item.id === input.accountId);
  if (!account) throw new ZernioServiceError(404, ACCOUNT_NOT_FOUND);
  const capability = automationCapability(account.platform);
  const problem = automationInputProblem(input, capability);
  if (problem) throw new ZernioServiceError(400, problem);
  // A Zernio não documenta Idempotency-Key aqui: o nome único por conta impede que repetir o pedido crie outra automação
  const existing = await listOwn(ctx, row, client, accounts);
  if (existing.some(({ item, account: owner }) => owner.id === account.id && sameName(item.name, input.name))) throw new ZernioServiceError(409, DUPLICATE_NAME);
  let created: ZernioCommentAutomation;
  try {
    // Sempre pausada: ativar é outra ação, com confirmação (PLANO_MODULO_AUTOMACOES §3)
    created = await client.createCommentAutomation({ profileId: row.profileId, accountId: account.id, isActive: false, ...zernioBody(input, capability) });
  } catch (err) {
    return writeFailure(ctx, row, err, 'criar');
  }
  return toDetail(created, account, member, writeEnabled);
}

export async function updateAutomation(ctx: ZernioContext, member: Member, automationId: string, body: unknown, writeEnabled: boolean): Promise<AutomationDetail> {
  requireWriter(member, writeEnabled);
  const input = parseBody(automationUpdateSchema, body);
  const { row, client, accounts, item, account } = await loadOwn(ctx, member, automationId);
  // A tela edita só os gatilhos que ela cria; outros (resposta a story, live) foram feitos no painel da Zernio
  if (item.trigger !== 'comment' && item.trigger !== 'story_mention') throw new ZernioServiceError(409, FOREIGN_TRIGGER);
  if (item.trigger !== input.trigger) throw new ZernioServiceError(400, TRIGGER_FIXED);
  const capability = automationCapability(account.platform);
  const problem = automationInputProblem(input, capability);
  if (problem) throw new ZernioServiceError(400, problem);
  const existing = await listOwn(ctx, row, client, accounts);
  if (existing.some(({ item: other, account: owner }) => other.id !== item.id && owner.id === account.id && sameName(other.name, input.name))) throw new ZernioServiceError(409, DUPLICATE_NAME);
  let updated: ZernioCommentAutomation | null;
  try {
    updated = await client.updateCommentAutomation(item.id, zernioBody(input, capability, item));
    updated ??= await client.getCommentAutomation(item.id);
  } catch (err) {
    return writeFailure(ctx, row, err, 'alterar');
  }
  return toDetail(updated, account, member, writeEnabled);
}

export async function setAutomationState(ctx: ZernioContext, member: Member, automationId: string, body: unknown, writeEnabled: boolean): Promise<AutomationDetail> {
  requireWriter(member, writeEnabled);
  const { active } = parseBody(automationStateInputSchema, body);
  const { row, client, item, account } = await loadOwn(ctx, member, automationId);
  if (active && automationCapability(account.platform) === 'unsupported') throw new ZernioServiceError(400, 'Esta rede não aceita automações pela Zernio.');
  let updated: ZernioCommentAutomation | null;
  try {
    updated = await client.updateCommentAutomation(item.id, { isActive: active });
    updated ??= await client.getCommentAutomation(item.id);
  } catch (err) {
    return writeFailure(ctx, row, err, active ? 'ativar' : 'pausar');
  }
  return toDetail(updated, account, member, writeEnabled);
}

export async function deleteAutomation(ctx: ZernioContext, member: Member, automationId: string, writeEnabled: boolean): Promise<{ id: string }> {
  requireWriter(member, writeEnabled);
  const { row, client, item } = await loadOwn(ctx, member, automationId);
  try {
    await client.deleteCommentAutomation(item.id);
  } catch (err) {
    return writeFailure(ctx, row, err, 'excluir');
  }
  return { id: item.id };
}

// ----- Atividade (A4): registros de envio e comentários que não casaram -----

const ACTIVITY_LIMIT = 50;
const ACTIVITY_LABELS: Readonly<Record<string, string>> = {
  sent: 'DM enviada',
  pending: 'Na fila (envio com atraso)',
  gated: 'Aguardando a confirmação de quem segue a conta',
  failed: 'Falha no envio da DM',
};
const REPEAT_OR_COOLDOWN = /repeat|cooldown|dedupe/i;

/**
 * Texto fixo para cada situação. Para "pulado", a Zernio informa o motivo em texto livre: aqui só se classifica
 * (repetição ou intervalo); o texto em si não sai da API (regra de erros fixos do plano).
 */
function activityLabel(status: string, error: string | null): string {
  if (status === 'skipped') {
    return REPEAT_OR_COOLDOWN.test(error ?? '')
      ? 'Não enviada: regra de repetição ou intervalo entre respostas'
      : 'Não enviada (motivo não reconhecido pelo DisparaZap)';
  }
  return ACTIVITY_LABELS[status] ?? 'Situação não reconhecida';
}

export async function automationActivity(ctx: ZernioContext, member: Member, automationId: string): Promise<AutomationActivity> {
  const { row, client, item } = await loadOwn(ctx, member, automationId);
  let result: Awaited<ReturnType<ZernioClient['listCommentAutomationLogs']>>;
  try {
    result = await client.listCommentAutomationLogs(item.id, { limit: ACTIVITY_LIMIT, skip: 0 });
  } catch (err) {
    return fromZernio(ctx, row, err, { leitura: 'automacoes.atividade' });
  }
  const manager = canManage(member);
  return {
    entries: result.logs.map((log) => ({ id: log.id, status: log.status, label: activityLabel(log.status, log.error), source: log.source, at: log.createdAt, clicks: log.clickCount })),
    total: result.total,
    // Nome e texto de quem comentou só para dono e administradores (A7)
    misses:
      manager && result.misses
        ? { total: result.misses.total, samples: result.misses.samples.map((sample) => ({ commentText: sample.commentText, commenterName: sample.commenterName, excludedBy: sample.excludedBy, at: sample.at })) }
        : null,
    canManage: manager,
  };
}

// ----- Link ou QR → conversa (A5, só Instagram, nasce pausada) -----

const FLOW_INSTAGRAM_ONLY = 'O link de conversa está disponível só para contas do Instagram nesta etapa.';
const FLOW_NEEDS_USERNAME = 'Não encontramos o @usuário desta conta na Zernio. Confira a conta e tente de novo.';
const FLOW_REF_TAKEN = 'Já existe um link com este código nesta conta. Use outro código.';
const FLOW_NOT_FOUND = 'Fluxo não encontrado nesta empresa.';
const FLOW_NO_LINK = 'Este fluxo ainda não tem link: o código do link não foi encontrado nele.';
/** Descrição do fluxo: guarda o código do link, porque a lista da Zernio não traz o gatilho */
const FLOW_DESCRIPTION_PREFIX = 'DisparaZap link: ';

const refOf = (description: string | null): string | null => {
  const match = /^DisparaZap link: ([a-z0-9-]+)$/.exec(description ?? '');
  return match?.[1] ?? null;
};

/** Descrição dos fluxos de pergunta antes do link (A6) */
const FLOW_QUESTION_DESCRIPTION = 'DisparaZap pergunta';

function toFlow(item: ZernioWorkflow, account: ZernioAccount | undefined): FlowSummary {
  const ref = refOf(item.description);
  const username = account?.username ? account.username.replace(/^@/, '') : null;
  const instagram = account?.platform === 'instagram';
  const kind = ref ? 'link' : item.description === FLOW_QUESTION_DESCRIPTION ? 'question' : 'other';
  return {
    id: item.id,
    name: item.name || 'Fluxo sem nome',
    accountId: item.accountId,
    accountName: account ? accountName(account) : null,
    kind,
    ref,
    link: instagram && ref && username ? `https://ig.me/m/${username}?ref=${ref}` : null,
    status: item.status,
    isActive: item.status === 'active',
    nodeCount: item.nodeCount,
    totalStarted: item.totalStarted,
    totalCompleted: item.totalCompleted,
  };
}

/** Grafo do fluxo: gatilho de referência → mensagem de texto → etiqueta → fim */
function flowBody(profileId: string, accountId: string, input: FlowInput): ZernioWorkflowBody {
  return {
    profileId,
    accountId,
    platform: 'instagram',
    name: input.name,
    description: `${FLOW_DESCRIPTION_PREFIX}${input.ref}`,
    nodes: [
      { id: 'n_trigger', type: 'trigger', config: { triggerType: 'referral', referral: { ref: input.ref, matchType: 'exact' }, cooldownHours: input.cooldownHours } },
      { id: 'n_message', type: 'send_message', config: { messageType: 'text', text: input.message } },
      { id: 'n_tag', type: 'add_tag', config: { tag: input.tag } },
      { id: 'n_end', type: 'end' },
    ],
    edges: [
      { id: 'e_trigger_message', source: 'n_trigger', target: 'n_message' },
      { id: 'e_message_tag', source: 'n_message', target: 'n_tag' },
      { id: 'e_tag_end', source: 'n_tag', target: 'n_end' },
    ],
  };
}

/** Fluxos da Zernio cuja conta é do perfil da empresa (os demais são descartados) */
async function listOwnFlows(ctx: ZernioContext, row: ConnectionRow, client: ZernioClient, accounts: readonly ZernioAccount[]) {
  let items: ZernioWorkflow[];
  try {
    items = await client.listWorkflows(row.profileId);
  } catch (err) {
    return fromZernio(ctx, row, err, { leitura: 'automacoes.fluxos' });
  }
  return items.flatMap((item) => {
    const account = item.accountId ? accounts.find((candidate) => candidate.id === item.accountId) : undefined;
    return account ? [{ item, account }] : [];
  });
}

/** Fluxo da empresa (lido agora na Zernio) ou 404 */
async function ownFlow(ctx: ZernioContext, member: Member, flowId: string) {
  if (!ID_PATTERN.test(flowId)) throw new ZernioServiceError(404, FLOW_NOT_FOUND);
  const { row, client, accounts } = await scope(ctx, member);
  const owned = (await listOwnFlows(ctx, row, client, accounts)).find(({ item }) => item.id === flowId);
  if (!owned) throw new ZernioServiceError(404, FLOW_NOT_FOUND);
  return { row, client, ...owned };
}

export async function flowsList(ctx: ZernioContext, member: Member, writeEnabled: boolean): Promise<FlowsList> {
  const { row, client, accounts } = await scope(ctx, member);
  const flows = (await listOwnFlows(ctx, row, client, accounts)).map(({ item, account }) => toFlow(item, account));
  return { flows, writeEnabled, canManage: canManage(member) };
}

export async function createFlow(ctx: ZernioContext, member: Member, body: unknown, writeEnabled: boolean): Promise<FlowSummary> {
  requireWriter(member, writeEnabled);
  const input = parseBody(flowInputSchema, body);
  const { row, client, accounts } = await scope(ctx, member);
  const account = accounts.find((item) => item.id === input.accountId);
  if (!account) throw new ZernioServiceError(404, ACCOUNT_NOT_FOUND);
  if (account.platform !== 'instagram') throw new ZernioServiceError(400, FLOW_INSTAGRAM_ONLY);
  if (!account.username) throw new ZernioServiceError(400, FLOW_NEEDS_USERNAME);
  const existing = await listOwnFlows(ctx, row, client, accounts);
  if (existing.some(({ item, account: owner }) => owner.id === account.id && sameName(item.name, input.name))) throw new ZernioServiceError(409, DUPLICATE_NAME);
  if (existing.some(({ item, account: owner }) => owner.id === account.id && refOf(item.description) === input.ref)) throw new ZernioServiceError(409, FLOW_REF_TAKEN);
  let created: ZernioWorkflow;
  try {
    // Sempre pausado: ativar é outra ação, com confirmação
    created = await client.createWorkflow(flowBody(row.profileId, account.id, input));
  } catch (err) {
    return writeFailure(ctx, row, err, 'criar fluxo');
  }
  return toFlow(created, account);
}

/**
 * Grafo "perguntar antes" (A6): comentário com palavra-chave → pergunta em texto → espera a resposta →
 * botão com o link. Sem resposta no prazo, o fluxo termina. Sem condição: qualquer resposta libera o link.
 */
function questionBody(profileId: string, accountId: string, input: QuestionFlowInput): ZernioWorkflowBody {
  return {
    profileId,
    accountId,
    platform: 'instagram',
    name: input.name,
    description: FLOW_QUESTION_DESCRIPTION,
    nodes: [
      { id: 'n_trigger', type: 'trigger', config: { triggerType: 'comment', comment: { keywords: input.keywords, matchType: 'contains' } } },
      { id: 'n_question', type: 'send_message', config: { messageType: 'text', text: input.question } },
      { id: 'n_wait', type: 'wait_for_reply', config: { timeoutMinutes: 1440, saveAs: 'answer' } },
      { id: 'n_link', type: 'send_message', config: { messageType: 'text', text: input.reward, buttons: [{ type: 'url', title: input.buttonTitle, url: input.url }] } },
      { id: 'n_end', type: 'end' },
    ],
    edges: [
      { id: 'e_trigger_question', source: 'n_trigger', target: 'n_question' },
      { id: 'e_question_wait', source: 'n_question', target: 'n_wait' },
      { id: 'e_wait_link', source: 'n_wait', target: 'n_link', sourceHandle: 'reply' },
      { id: 'e_wait_end', source: 'n_wait', target: 'n_end', sourceHandle: 'timeout' },
      { id: 'e_link_end', source: 'n_link', target: 'n_end' },
    ],
  };
}

export async function createQuestionFlow(ctx: ZernioContext, member: Member, body: unknown, writeEnabled: boolean): Promise<FlowSummary> {
  requireWriter(member, writeEnabled);
  const input = parseBody(questionFlowInputSchema, body);
  const { row, client, accounts } = await scope(ctx, member);
  const account = accounts.find((item) => item.id === input.accountId);
  if (!account) throw new ZernioServiceError(404, ACCOUNT_NOT_FOUND);
  if (account.platform !== 'instagram') throw new ZernioServiceError(400, FLOW_INSTAGRAM_ONLY);
  const existing = await listOwnFlows(ctx, row, client, accounts);
  if (existing.some(({ item, account: owner }) => owner.id === account.id && sameName(item.name, input.name))) throw new ZernioServiceError(409, DUPLICATE_NAME);
  let created: ZernioWorkflow;
  try {
    // Sempre pausado. Uma automação de comentário com a mesma palavra responde antes e este fluxo não inicia (documentação)
    created = await client.createWorkflow(questionBody(row.profileId, account.id, input));
  } catch (err) {
    return writeFailure(ctx, row, err, 'criar pergunta antes do link');
  }
  return toFlow(created, account);
}

export async function setFlowState(ctx: ZernioContext, member: Member, flowId: string, body: unknown, writeEnabled: boolean): Promise<FlowSummary> {
  requireWriter(member, writeEnabled);
  const { active } = parseBody(automationStateInputSchema, body);
  const { row, client, item, account } = await ownFlow(ctx, member, flowId);
  let updated: ZernioWorkflow;
  try {
    updated = await client.setWorkflowActive(item.id, active);
  } catch (err) {
    return writeFailure(ctx, row, err, active ? 'ativar fluxo' : 'pausar fluxo');
  }
  // Mantém o código e os números da lista; só o estado vem da resposta
  return toFlow({ ...item, status: updated.status }, account);
}

/**
 * QR code do link (A5): gerado aqui, com a biblioteca qrcode. Qualquer pessoa da empresa vê, como vê o link na lista.
 * Só o link entra no QR: nada da mensagem, da etiqueta ou da Zernio.
 */
export async function flowQr(ctx: ZernioContext, member: Member, flowId: string): Promise<FlowQr> {
  const { item, account } = await ownFlow(ctx, member, flowId);
  const link = toFlow(item, account).link;
  if (!link) throw new ZernioServiceError(400, FLOW_NO_LINK);
  const dataUrl = await QRCode.toDataURL(link, { type: 'image/png', errorCorrectionLevel: 'M', margin: 2, width: 320 });
  return { link, dataUrl };
}

export async function deleteFlow(ctx: ZernioContext, member: Member, flowId: string, writeEnabled: boolean): Promise<{ id: string }> {
  requireWriter(member, writeEnabled);
  const { row, client, item } = await ownFlow(ctx, member, flowId);
  try {
    await client.deleteWorkflow(item.id);
  } catch (err) {
    return writeFailure(ctx, row, err, 'excluir fluxo');
  }
  return { id: item.id };
}
