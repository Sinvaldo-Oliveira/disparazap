import { Bot, LayoutDashboard, Megaphone, MessageCircle, Plug, Send, Settings, Share2, Users, Workflow, type LucideIcon } from 'lucide-react';

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
    id: 'whatsapp',
    label: 'WhatsApp',
    path: '/whatsapp',
    icon: MessageCircle,
    status: 'available',
    permission: 'whatsapp:view',
    summary: 'Conectar números pelo Evolution Go (QR Code ou código de pareamento) e acompanhar o status de cada instância.',
    plannedFor: 'Disponível: instâncias e conexão',
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
    summary: 'Agendamentos e acompanhamentos automáticos a partir de eventos.',
    plannedFor: 'Depois do primeiro MVP SaaS',
  },
  {
    id: 'social',
    label: 'Redes Sociais',
    path: '/redes-sociais',
    icon: Share2,
    status: 'in_development',
    permission: 'social:view',
    summary: 'Contas de redes sociais conectadas pela Zernio, conforme o que a documentação oficial confirmar.',
    plannedFor: 'Depois do primeiro MVP SaaS',
  },
  {
    id: 'integrations',
    label: 'Integrações',
    path: '/integracoes',
    icon: Plug,
    status: 'in_development',
    permission: 'integrations:view',
    summary: 'API REST versionada e webhooks assinados para o MyLinksss e outras plataformas.',
    plannedFor: 'Etapa 10 do primeiro MVP SaaS',
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
