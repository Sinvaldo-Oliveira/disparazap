import * as z from 'zod';

// Importado antes de tudo no main.tsx: o Zod decide se usa eval quando os schemas são criados.
// O painel roda com uma política de conteúdo (CSP) sem eval; sem isto, o Zod testaria eval e o navegador
// registraria um bloqueio no console (inofensivo, mas ruído). A validação continua igual, só sem a otimização.
z.config({ jitless: true });
