import { configure } from '@testing-library/react';

// Testes do painel rodam junto com os da API (banco embutido, servidores simulados). Sob essa carga, a espera padrão de
// 1 s do findBy/waitFor às vezes acaba antes da tela; 5 s evita falhas por lentidão sem esconder erro de verdade.
configure({ asyncUtilTimeout: 5000 });
