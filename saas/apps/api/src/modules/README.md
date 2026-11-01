# Módulos de domínio da API

Vazio na Fase 4, de propósito. Cada módulo de negócio entra aqui como uma pasta própria
(ex.: `auth/`, `organizations/`, `whatsapp/`), com rotas, serviços e acesso a dados **somente dele**.

Regras (ver `docs/ARQUITETURA_SAAS.md` §3.3):
- um módulo não lê tabelas de outro; usa a interface exportada pelo outro módulo;
- integrações externas ficam atrás de adaptadores (`WhatsAppProvider`, `SocialProvider`, `AiProvider`);
- nenhuma rota de módulo é registrada sem autenticação e verificação de permissão.

Próximos módulos: autenticação, Super Admin e empresas (Fase 5).
