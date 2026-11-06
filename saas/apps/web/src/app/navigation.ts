import { Bot, Inbox, LayoutDashboard, Megaphone, Plug, Send, Settings, Share2, Users, Workflow, type LucideIcon } from 'lucide-react';

export type ModuleStatus = 'available' | 'in_development';

export interface NavigationItem {
  readonly id: string;
  readonly label: string;
  readonly path: string;
  readonly icon: LucideIcon;
  readonly status: ModuleStatus;
  /** Permissão exigida para ver o item. Verificada quando houver autenticação (Fase 5). */
  readonly permission: string;
  /** O que o módulo fará — escopo planejado, não funcionalidade existente */
  readonly summary: string;
  /** Em que ponto do roteiro (docs/DISPARAZAP_MASTER.md) o módulo está previsto */
  readonly plannedFor: string;
}

export const NAVIGATION: readonly NavigationItem[] = [
  {
    id: 'overview',
    label: 'Visão Geral',
    path: '/',
    icon: LayoutDashboard,
    status: 'available',
    permission: 'overview:view',
    summary: 'Apresentação do ambiente de desenvolvimento.',
    plannedFor: 'Disponível',
  },
  {
    id: 'inbox',
    label: 'Inbox',
    path: '/inbox',
    icon: Inbox,
    status: 'available',
    permission: 'inbox:view',
    summary: 'Conversas com os clientes que escrevem para os números de WhatsApp da empresa: lista, histórico, respostas e confirmações de entrega e leitura. Instagram, Facebook, mídias, IA e automações nas próximas etapas.',
    plannedFor: 'Disponível: WhatsApp (o recebimento é ligado depois da homologação)',
  },
  {
    id: 'campaigns',
    label: 'Campanhas',
    path: '/campanhas',
    icon: Megaphone,
    status: 'in_development',
    permission: 'campaigns:view',
    summary: 'Disparos executados no servidor, com fila, pausa, histórico e campanhas de teste.',
    plannedFor: 'Etapa 9 do primeiro MVP SaaS',
  },
  {
    id: 'send',
    label: 'Envio de Mensagens',
    path: '/envio-de-mensagens',
    icon: Send,
    status: 'available',
    permission: 'messaging:send',
    summary: 'Disparo de mensagens de texto para listas de contatos salvas da empresa, pela instância conectada, com intervalo entre envios e variações de mensagem.',
    plannedFor: 'Disponível: envio acompanhado nesta página (o disparo roda com a página aberta)',
  },
  {
    id: 'contacts',
    label: 'Contatos',
    path: '/contatos',
    icon: Users,
    status: 'available',
    permission: 'contacts:view',
    summary: 'Listas de contatos da empresa: criar, importar planilhas, buscar em todas as listas, editar e remover contatos. Consentimento e descadastro virão na Etapa 8.',
    plannedFor: 'Disponível: gestão das listas de contatos (consentimento e descadastro na Etapa 8)',
  },
  {
    id: 'agents',
    label: 'Agentes de IA',
    path: '/agentes-ia',
    icon: Bot,
    status: 'in_development',
    permission: 'agents:view',
    summary: 'Atendentes automáticos com personalidade, base de conhecimento e regras de transferência para humanos.',
    plannedFor: 'Depois do primeiro MVP SaaS',
  },
  {
    id: 'automations',
    label: 'Automações',
    path: '/automacoes',
    icon: Workflow,
    status: 'in_development',
    permission: 'automations:view',
    summary: 'Automações de redes pela Zernio (comentário → DM, menção em story e mais): consulta nesta etapa; criar e ativar nas próximas. Campanhas, filas e acompanhamentos no servidor vêm depois.',
    plannedFor: 'Etapas A2 a A6 (PLANO_MODULO_AUTOMACOES); campanhas e filas na etapa 9',
  },
  {
    id: 'social',
    label: 'Redes Sociais',
    path: '/redes-sociais',
    icon: Share2,
    status: 'available',
    permission: 'social:view',
    summary: 'Publicar, agendar e acompanhar as redes conectadas pela Zernio: visão geral, criar publicação, calendário, histórico, biblioteca de imagens e resultados.',
    plannedFor: 'Disponível: imagem e texto (vídeo, interações e webhooks nas próximas etapas)',
  },
  {
    id: 'integrations',
    label: 'Integrações',
    path: '/integracoes',
    icon: Plug,
    status: 'available',
    permission: 'integrations:view',
    summary: 'Conexões da empresa: WhatsApp pela Evolution Go (instâncias, QR Code e código de pareamento) e redes sociais pela Zernio. API e webhooks para o MyLinksss virão na Etapa 10.',
    plannedFor: 'Disponível: WhatsApp (Evolution Go) e Zernio (redes sociais); API e webhooks para o MyLinksss na Etapa 10',
  },
  {
    id: 'settings',
    label: 'Configurações',
    path: '/configuracoes',
    icon: Settings,
    status: 'in_development',
    permission: 'settings:view',
    summary: 'Empresa, usuários, papéis e permissões.',
    plannedFor: 'Etapas 2 a 4 do primeiro MVP SaaS (a partir da Fase 5)',
  },
];

export function visibleNavigation(
  items: readonly NavigationItem[],
  canView: (permission: string) => boolean,
): NavigationItem[] {
  return items.filter((item) => canView(item.permission));
}
