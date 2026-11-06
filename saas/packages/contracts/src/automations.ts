import { z } from 'zod';
import { INTERNAL_API_PREFIX } from './auth.ts';

/**
 * Automações de redes pela Zernio (PLANO_MODULO_AUTOMACOES). A Zernio guarda as automações; a API lê e confere se a
 * conta de cada uma é do perfil da empresa. Etapa A1: só leitura (lista e detalhes).
 */
export const AUTOMATIONS_PATH = `${INTERNAL_API_PREFIX}/automations`;
export const AUTOMATIONS_OVERVIEW_PATH = `${AUTOMATIONS_PATH}/overview`;
export const AUTOMATIONS_COMMENT_PATH = `${AUTOMATIONS_PATH}/comment`;
export const automationDetailPath = (id: string) => `${AUTOMATIONS_COMMENT_PATH}/${encodeURIComponent(id)}`;
/** Ativar ou pausar (etapa A2): POST com { active } */
export const automationStatePath = (id: string) => `${automationDetailPath(id)}/state`;

/** Limites da documentação oficial da Zernio (comment-automations, lida em 2026-11-05) */
export const AUTOMATION_LIMITS = {
  dmWithButtons: 640,
  dmWithoutButtons: 1000,
  buttonsMax: 3,
  buttonTitleMax: 20,
  cooldownHoursMin: 1,
  cooldownHoursMax: 8760,
} as const;

/**
 * O que cada rede permite numa automação (documentação oficial):
 * full = DM, botões, só seguidores e story (Instagram); dm = DM e botões, sem story (Facebook);
 * public_reply = só resposta pública ao comentário (TikTok, Threads, LinkedIn, YouTube); unsupported = nada (X e outras).
 */
export const AUTOMATION_CAPABILITIES = ['full', 'dm', 'public_reply', 'unsupported'] as const;
export type AutomationCapability = (typeof AUTOMATION_CAPABILITIES)[number];

const PUBLIC_REPLY_ONLY: readonly string[] = ['tiktok', 'threads', 'linkedin', 'youtube'];

export function automationCapability(platform: string): AutomationCapability {
  if (platform === 'instagram') return 'full';
  if (platform === 'facebook') return 'dm';
  if (PUBLIC_REPLY_ONLY.includes(platform)) return 'public_reply';
  return 'unsupported';
}

export const automationAccountSchema = z.strictObject({
  id: z.string(),
  platform: z.string(),
  /** @usuário ou nome da conta, como a Zernio informa */
  name: z.string(),
  capability: z.enum(AUTOMATION_CAPABILITIES),
});
export type AutomationAccount = z.infer<typeof automationAccountSchema>;

const counter = z.number().int().nonnegative();

export const automationSummarySchema = z.strictObject({
  id: z.string(),
  kind: z.literal('comment'),
  name: z.string(),
  platform: z.string(),
  accountId: z.string(),
  accountName: z.string(),
  /** comment, live_comment, story_reply ou story_mention (outro valor da Zernio aparece como está) */
  trigger: z.string(),
  keywords: z.array(z.string()),
  /** exact, contains ou word */
  matchMode: z.string().nullable(),
  /** true = vale para uma postagem só; false = qualquer postagem da conta */
  postBound: z.boolean(),
  postTitle: z.string().nullable(),
  isActive: z.boolean(),
  repeat: z.strictObject({ mode: z.enum(['once', 'every_comment']), cooldownHours: z.number().int().nullable() }),
  followersOnly: z.boolean(),
  hasDm: z.boolean(),
  hasPublicReply: z.boolean(),
  stats: z.strictObject({
    triggered: counter,
    dmsSent: counter,
    dmsFailed: counter,
    uniqueContacts: counter,
    linkClicks: counter,
    /** Só seguidores (A3): botões "Estou seguindo" enviados e recompensas liberadas depois da confirmação */
    followGateSent: counter,
    followGatePassed: counter,
  }),
  createdAt: z.string().nullable(),
});
export type AutomationSummary = z.infer<typeof automationSummarySchema>;

/** Verificação de seguidor (A3, só Instagram): quem a Zernio ainda não sabe se segue recebe primeiro esta mensagem */
export const followGateSchema = z.strictObject({
  message: z.string(),
  buttonLabel: z.string(),
  notFollowingMessage: z.string(),
});
export type FollowGate = z.infer<typeof followGateSchema>;

export const automationsOverviewSchema = z.strictObject({
  accounts: z.array(automationAccountSchema),
  automations: z.array(automationSummarySchema),
  totals: z.strictObject({ active: counter, dmsSent: counter, linkClicks: counter }),
  /** Trava geral AUTOMATIONS_WRITE_ENABLED: desligada, nada é criado nem ativado na Zernio */
  writeEnabled: z.boolean(),
  /** Dono e administradores gerenciam (decisão A2); os demais só veem */
  canManage: z.boolean(),
});
export type AutomationsOverview = z.infer<typeof automationsOverviewSchema>;

export const automationDetailSchema = z.strictObject({
  automation: automationSummarySchema,
  /** Mesmos valores da visão geral: a página da automação decide se mostra Editar, Ativar, Pausar e Excluir */
  writeEnabled: z.boolean(),
  canManage: z.boolean(),
  /** Texto da DM, escrito pela própria empresa (nunca vai para o log) */
  dmMessage: z.string().nullable(),
  buttons: z.array(z.strictObject({ type: z.string(), title: z.string(), url: z.string().nullable() })),
  commentReply: z.string().nullable(),
  /** after_dm (padrão) ou always */
  publicReplyPolicy: z.string().nullable(),
  /** Também responde quando a pessoa manda a palavra por DM (decisão A4: desligado por padrão) */
  alsoMatchInDms: z.boolean(),
  /** Só seguidores (A3): a mensagem de verificação e o rótulo do botão; null quando vale para todos */
  followGate: followGateSchema.nullable(),
});
export type AutomationDetail = z.infer<typeof automationDetailSchema>;

// ----- Criar, editar, ativar e pausar (etapa A2: Comentário → DM e Comentário → resposta pública) -----

export const AUTOMATION_INPUT_LIMITS = { nameMax: 80, keywordsMax: 20, keywordMax: 50, publicReplyMax: 1000, urlMax: 500 } as const;
export const AUTOMATION_MATCH_MODES = ['word', 'contains', 'exact'] as const;
export const AUTOMATION_REPEAT_MODES = ['once', 'every_comment'] as const;

const automationButtonInputSchema = z.strictObject({
  title: z.string().trim().min(1, 'Escreva o rótulo de cada botão.').max(AUTOMATION_LIMITS.buttonTitleMax, `O rótulo do botão tem até ${AUTOMATION_LIMITS.buttonTitleMax} caracteres.`),
  url: z
    .string()
    .trim()
    .max(AUTOMATION_INPUT_LIMITS.urlMax, `O link do botão tem até ${AUTOMATION_INPUT_LIMITS.urlMax} caracteres.`)
    .regex(/^https:\/\/[^\s/]+\.[^\s]+$/i, 'O link do botão precisa ser um endereço completo, começando com https://.'),
});

/** Gatilhos que o DisparaZap cria: comentário (A2) e menção em story (A3, só Instagram) */
export const AUTOMATION_INPUT_TRIGGERS = ['comment', 'story_mention'] as const;

const followGateInputSchema = z.strictObject({
  message: z
    .string()
    .trim()
    .min(1, 'Escreva a mensagem que pede para a pessoa confirmar que segue a conta.')
    .max(AUTOMATION_LIMITS.dmWithButtons, `A mensagem de verificação tem até ${AUTOMATION_LIMITS.dmWithButtons} caracteres.`),
  buttonLabel: z.string().trim().min(1, 'Escreva o rótulo do botão de confirmação.').max(AUTOMATION_LIMITS.buttonTitleMax, `O rótulo do botão de confirmação tem até ${AUTOMATION_LIMITS.buttonTitleMax} caracteres.`),
  notFollowingMessage: z
    .string()
    .trim()
    .min(1, 'Escreva a mensagem para quem ainda não segue a conta.')
    .max(AUTOMATION_LIMITS.dmWithoutButtons, `A mensagem para quem não segue tem até ${AUTOMATION_LIMITS.dmWithoutButtons} caracteres.`),
});

const automationFieldsSchema = z.strictObject({
  name: z.string().trim().min(1, 'Dê um nome à automação.').max(AUTOMATION_INPUT_LIMITS.nameMax, `O nome tem até ${AUTOMATION_INPUT_LIMITS.nameMax} caracteres.`),
  /** Comentário (padrão) ou menção em story; não muda depois de criada */
  trigger: z.enum(AUTOMATION_INPUT_TRIGGERS, { message: 'Escolha o que dispara a automação.' }).default('comment'),
  // Pelo menos uma palavra-chave no comentário (regra em automationInputProblem); a menção em story não usa nenhuma
  keywords: z
    .array(z.string().trim().min(1, 'Palavra-chave vazia.').max(AUTOMATION_INPUT_LIMITS.keywordMax, `Cada palavra-chave tem até ${AUTOMATION_INPUT_LIMITS.keywordMax} caracteres.`))
    .max(AUTOMATION_INPUT_LIMITS.keywordsMax, `Use no máximo ${AUTOMATION_INPUT_LIMITS.keywordsMax} palavras-chave.`),
  /** Só seguidores (A3, só Instagram): null = vale para todos */
  followGate: followGateInputSchema.nullable().default(null),
  matchMode: z.enum(AUTOMATION_MATCH_MODES, { message: 'Escolha como procurar a palavra-chave.' }),
  /** Texto da DM; null nas redes que só respondem em público */
  dmMessage: z.string().trim().max(AUTOMATION_LIMITS.dmWithoutButtons, `A DM tem até ${AUTOMATION_LIMITS.dmWithoutButtons} caracteres.`).nullable(),
  buttons: z.array(automationButtonInputSchema).max(AUTOMATION_LIMITS.buttonsMax, `Use no máximo ${AUTOMATION_LIMITS.buttonsMax} botões.`),
  /** Resposta pública no comentário: opcional no Instagram e no Facebook, obrigatória nas outras redes */
  commentReply: z.string().trim().max(AUTOMATION_INPUT_LIMITS.publicReplyMax, `A resposta pública tem até ${AUTOMATION_INPUT_LIMITS.publicReplyMax} caracteres.`).nullable(),
  repeat: z.strictObject({
    mode: z.enum(AUTOMATION_REPEAT_MODES, { message: 'Escolha com que frequência responder.' }),
    cooldownHours: z
      .number()
      .int('A espera é em horas inteiras.')
      .min(AUTOMATION_LIMITS.cooldownHoursMin, `A espera é de ${AUTOMATION_LIMITS.cooldownHoursMin} a ${AUTOMATION_LIMITS.cooldownHoursMax} horas.`)
      .max(AUTOMATION_LIMITS.cooldownHoursMax, `A espera é de ${AUTOMATION_LIMITS.cooldownHoursMin} a ${AUTOMATION_LIMITS.cooldownHoursMax} horas.`)
      .nullable(),
  }),
});

/** Criar: a conta não muda depois (para trocar de conta, crie outra automação) */
export const automationInputSchema = automationFieldsSchema.extend({ accountId: z.string().min(1, 'Escolha a conta.').max(100) });
export type AutomationInput = z.infer<typeof automationInputSchema>;
export const automationUpdateSchema = automationFieldsSchema;
export type AutomationUpdate = z.infer<typeof automationUpdateSchema>;
export const automationStateInputSchema = z.strictObject({ active: z.boolean() });

// ----- Link ou QR → conversa (A5, PLANO_MODULO_AUTOMACOES) -----
// Um fluxo de referência (ig.me/m/<usuário>?ref=<código>): envia a mensagem, marca a pessoa e nasce pausado.
// Só Instagram nesta etapa. O QR code depende de aprovar a biblioteca de QR (decisão A6): ainda não existe.
export const AUTOMATIONS_FLOWS_PATH = `${AUTOMATIONS_PATH}/flows`;
export const automationFlowPath = (id: string) => `${AUTOMATIONS_FLOWS_PATH}/${encodeURIComponent(id)}`;
export const automationFlowStatePath = (id: string) => `${automationFlowPath(id)}/state`;

export const AUTOMATION_FLOW_LIMITS = { nameMax: 80, refMin: 3, refMax: 60, messageMax: 1000, tagMax: 40, cooldownHoursMin: 1, cooldownHoursMax: 720 } as const;
/** Código do link: minúsculas, números e hífens (o ref do ig.me aceita isso sem escapar) */
export const FLOW_REF_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export const flowInputSchema = z.strictObject({
  accountId: z.string().min(1, 'Escolha a conta.').max(100),
  name: z.string().trim().min(1, 'Dê um nome ao fluxo.').max(AUTOMATION_FLOW_LIMITS.nameMax, `O nome tem até ${AUTOMATION_FLOW_LIMITS.nameMax} caracteres.`),
  ref: z
    .string()
    .trim()
    .min(AUTOMATION_FLOW_LIMITS.refMin, `O código do link tem pelo menos ${AUTOMATION_FLOW_LIMITS.refMin} caracteres.`)
    .max(AUTOMATION_FLOW_LIMITS.refMax, `O código do link tem até ${AUTOMATION_FLOW_LIMITS.refMax} caracteres.`)
    .regex(FLOW_REF_PATTERN, 'Use só letras minúsculas, números e hífens, sem espaços.'),
  message: z.string().trim().min(1, 'Escreva a mensagem que abre a conversa.').max(AUTOMATION_FLOW_LIMITS.messageMax, `A mensagem tem até ${AUTOMATION_FLOW_LIMITS.messageMax} caracteres.`),
  tag: z.string().trim().min(1, 'Dê uma etiqueta para marcar quem entrou.').max(AUTOMATION_FLOW_LIMITS.tagMax, `A etiqueta tem até ${AUTOMATION_FLOW_LIMITS.tagMax} caracteres.`),
  /** Mesma pessoa não dispara o fluxo de novo antes deste intervalo (a Zernio padroniza 24 h) */
  cooldownHours: z.number().int().min(AUTOMATION_FLOW_LIMITS.cooldownHoursMin).max(AUTOMATION_FLOW_LIMITS.cooldownHoursMax),
});
export type FlowInput = z.infer<typeof flowInputSchema>;

// ----- Comentário → perguntar antes (A6): comentário com palavra-chave → pergunta em texto → link após a resposta -----
// Instagram recusa botões numa resposta privada a quem não segue; por isso a pergunta vai em texto puro e o botão
// só vai depois que a pessoa responde (a documentação oficial traz esse exemplo).
export const AUTOMATIONS_FLOW_QUESTION_PATH = `${AUTOMATIONS_FLOWS_PATH}/question`;
export const AUTOMATION_QUESTION_LIMITS = { keywordsMax: 5, keywordMax: 50, questionMax: 1000, rewardMax: 1000, buttonTitleMax: 20, urlMax: 500 } as const;

export const questionFlowInputSchema = z.strictObject({
  accountId: z.string().min(1, 'Escolha a conta.').max(100),
  name: z.string().trim().min(1, 'Dê um nome ao fluxo.').max(AUTOMATION_FLOW_LIMITS.nameMax, `O nome tem até ${AUTOMATION_FLOW_LIMITS.nameMax} caracteres.`),
  keywords: z
    .array(z.string().trim().min(1, 'Palavra-chave vazia.').max(AUTOMATION_QUESTION_LIMITS.keywordMax, `Cada palavra-chave tem até ${AUTOMATION_QUESTION_LIMITS.keywordMax} caracteres.`))
    .min(1, 'Informe pelo menos uma palavra-chave.')
    .max(AUTOMATION_QUESTION_LIMITS.keywordsMax, `Use no máximo ${AUTOMATION_QUESTION_LIMITS.keywordsMax} palavras-chave.`),
  question: z.string().trim().min(1, 'Escreva a pergunta que a pessoa recebe.').max(AUTOMATION_QUESTION_LIMITS.questionMax, `A pergunta tem até ${AUTOMATION_QUESTION_LIMITS.questionMax} caracteres.`),
  reward: z.string().trim().min(1, 'Escreva a mensagem que acompanha o link.').max(AUTOMATION_QUESTION_LIMITS.rewardMax, `A mensagem tem até ${AUTOMATION_QUESTION_LIMITS.rewardMax} caracteres.`),
  buttonTitle: z.string().trim().min(1, 'Dê um texto ao botão.').max(AUTOMATION_QUESTION_LIMITS.buttonTitleMax, `O texto do botão tem até ${AUTOMATION_QUESTION_LIMITS.buttonTitleMax} caracteres.`),
  url: z
    .string()
    .trim()
    .max(AUTOMATION_QUESTION_LIMITS.urlMax, `O link tem até ${AUTOMATION_QUESTION_LIMITS.urlMax} caracteres.`)
    .regex(/^https:\/\/[^\s]+$/i, 'O link precisa começar com https://.'),
});
export type QuestionFlowInput = z.infer<typeof questionFlowInputSchema>;

export const flowSummarySchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  accountId: z.string().nullable(),
  accountName: z.string().nullable(),
  /** link: link com código (A5); question: pergunta antes do link (A6); other: criado fora do DisparaZap */
  kind: z.enum(['link', 'question', 'other']),
  /** Código do link (ref), lido da descrição do fluxo; null se o fluxo não foi criado pelo DisparaZap */
  ref: z.string().nullable(),
  /** Link pronto para copiar (ig.me/m/<usuário>?ref=…); null sem @usuário conhecido e nas perguntas */
  link: z.string().nullable(),
  /** status da Zernio: draft, active ou paused */
  status: z.string(),
  isActive: z.boolean(),
  nodeCount: counter,
  totalStarted: counter,
  totalCompleted: counter,
});
export type FlowSummary = z.infer<typeof flowSummarySchema>;

export const flowsListSchema = z.strictObject({
  flows: z.array(flowSummarySchema),
  /** Mesmos sentidos da visão geral: dono e administradores criam, ativam, pausam e excluem */
  writeEnabled: z.boolean(),
  canManage: z.boolean(),
});
export type FlowsList = z.infer<typeof flowsListSchema>;

/** QR code do link (A5, biblioteca qrcode gerada no servidor): PNG em data URL; o link é público, não é segredo */
export const automationFlowQrPath = (id: string) => `${automationFlowPath(id)}/qr`;
export const flowQrSchema = z.strictObject({
  link: z.string().url(),
  dataUrl: z.string().regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/),
});
export type FlowQr = z.infer<typeof flowQrSchema>;

// ----- Atividade (A4, PLANO_MODULO_AUTOMACOES): quem recebeu, quem foi pulado e por quê -----
/** A tela atualiza a atividade a cada 15 s (decisão A9; o limite da empresa é 120 leituras por minuto) */
export const ACTIVITY_REFRESH_MS = 15_000;
export const automationActivityPath = (id: string) => `${automationDetailPath(id)}/activity`;

export const automationActivitySchema = z.strictObject({
  /** Últimos envios e tentativas da automação, do mais recente para o mais antigo */
  entries: z.array(
    z.strictObject({
      id: z.string(),
      /** pending, sent, gated, skipped ou failed (outro valor da Zernio aparece como "Situação não reconhecida") */
      status: z.string(),
      /** Texto fixo que explica a situação; o texto da Zernio não sai da API */
      label: z.string(),
      /** comment, story_mention, dm… como a Zernio informa, ou null */
      source: z.string().nullable(),
      at: z.string().nullable(),
      clicks: counter,
    }),
  ),
  total: counter,
  /** Comentários que não casaram com nenhuma palavra-chave (A7): só dono e administradores; null para os demais */
  misses: z
    .strictObject({
      total: counter,
      samples: z.array(
        z.strictObject({ commentText: z.string().nullable(), commenterName: z.string().nullable(), excludedBy: z.string().nullable(), at: z.string().nullable() }),
      ),
    })
    .nullable(),
  canManage: z.boolean(),
});
export type AutomationActivity = z.infer<typeof automationActivitySchema>;

/**
 * Regras que dependem da rede (documentação oficial): as mesmas na tela e na API.
 * Devolve a primeira mensagem de problema, ou null quando está tudo certo.
 */
export function automationInputProblem(input: AutomationUpdate, capability: AutomationCapability): string | null {
  if (capability === 'unsupported') return 'Esta rede não aceita automações pela Zernio.';
  const dm = input.dmMessage?.trim() ?? '';
  const reply = input.commentReply?.trim() ?? '';
  if (input.trigger === 'story_mention') {
    if (capability !== 'full') return 'Menção em story só existe no Instagram.';
    if (input.keywords.length > 0) return 'Menção em story não usa palavra-chave: toda menção à conta conta.';
    if (reply) return 'Menção em story não tem resposta pública: não há comentário para responder.';
    if (input.followGate) return 'A recompensa só para seguidores vale para comentários, não para menção em story.';
  } else if (input.keywords.length === 0) {
    // Sem palavra-chave a Zernio responderia a qualquer comentário: risco de mensagens em massa (PLANO_MODULO_AUTOMACOES §8)
    return 'Informe pelo menos uma palavra-chave.';
  }
  if (input.followGate && capability !== 'full') return 'Só seguidores existe apenas no Instagram.';
  if (capability === 'public_reply') {
    if (dm || input.buttons.length > 0) return 'Nesta rede a automação só responde em público: sem DM e sem botões.';
    if (!reply) return 'Escreva a resposta pública.';
  } else {
    if (!dm) return 'Escreva o texto da DM.';
    const max = input.buttons.length > 0 ? AUTOMATION_LIMITS.dmWithButtons : AUTOMATION_LIMITS.dmWithoutButtons;
    if (dm.length > max) return `Com botões, a DM tem até ${AUTOMATION_LIMITS.dmWithButtons} caracteres; sem botões, até ${AUTOMATION_LIMITS.dmWithoutButtons}.`;
  }
  if (input.repeat.mode === 'every_comment' && input.repeat.cooldownHours === null) return 'Informe a espera, em horas, antes de responder de novo à mesma pessoa.';
  return null;
}
