import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Contact, ContactListSummary, MessageTemplate, MessageTemplateInput, SendTextResult, SessionInfo, WhatsAppInstance } from '@disparazap/contracts';
import { App } from '../app/App';
import type { AuthApi } from '../auth/auth-api';
import type { MessagingApi } from '../messaging/messaging-api';
import type { ReadSpreadsheet } from '../messaging/spreadsheet';
import type { WhatsAppApi } from '../whatsapp/whatsapp-api';
import type { Wait } from './SendMessagesPage';

afterEach(cleanup);

// Tudo fictício
const OWNER: SessionInfo = { user: { id: 'u1', name: 'Maria Teste', email: 'maria@empresa.test' }, userType: 'company_admin', organization: { id: 'o1', name: 'Empresa Teste', role: 'owner' } };
const SUPER_NO_ORG: SessionInfo = { user: { id: 'u0', name: 'Dono Plataforma', email: 'dono@disparazap.test' }, userType: 'super_admin', organization: null };

const instance = (overrides: Partial<WhatsAppInstance>): WhatsAppInstance => ({ id: 'i1', displayName: 'Vendas', status: 'connected', phone: '5511988887777', createdAt: '2026-11-01T12:00:00.000Z', connectedAt: '2026-11-01T12:05:00.000Z', ...overrides });
const CONNECTED = instance({});
const OFFLINE = instance({ id: 'i2', displayName: 'Suporte', status: 'disconnected', phone: null, connectedAt: null });

const SAVED: ContactListSummary = { id: 'l1', name: 'Clientes de maio', contactCount: 3, createdAt: '2026-11-01T12:00:00.000Z', updatedAt: '2026-11-01T12:00:00.000Z' };
const SAVED_CONTACTS: Contact[] = [
  { name: 'Ana', phone: '5511988887777' },
  { name: 'Bruno', phone: '5521998765432' },
  { name: '', phone: '5531988887777' },
];

function whatsappFake(instances: WhatsAppInstance[] = [CONNECTED]): WhatsAppApi {
  return {
    list: vi.fn(async () => ({ ok: true as const, data: { instances, limit: 1, canManage: true, integration: 'ready' as const } })),
    create: vi.fn(),
    connect: vi.fn(),
    qr: vi.fn(),
    pair: vi.fn(),
    status: vi.fn(),
    logout: vi.fn(),
    remove: vi.fn(),
    listAll: vi.fn(),
  } as unknown as WhatsAppApi;
}

const TEMPLATE: MessageTemplate = {
  id: 't1',
  name: 'Promoção de novembro',
  body: 'Olá {nome}! *20% de desconto*',
  variations: [],
  mediaId: 'img-salva',
  ctaText: 'Quero aproveitar',
  ctaUrl: 'https://loja.exemplo.test/promo',
  createdAt: '2026-11-01T12:00:00.000Z',
  updatedAt: '2026-11-01T12:00:00.000Z',
};

function messagingFake(overrides: Partial<MessagingApi> = {}, canSend = true): MessagingApi {
  return {
    lists: vi.fn(async () => ({ ok: true as const, data: { lists: [SAVED], canSend } })),
    getList: vi.fn(async () => ({ ok: true as const, data: { ...SAVED, contacts: SAVED_CONTACTS } })),
    createList: vi.fn(async (name: string, contacts: readonly Contact[]) => ({ ok: true as const, data: { list: { ...SAVED, id: 'l2', name, contactCount: contacts.length }, ignored: { invalid: 0, duplicate: 0 } } })),
    updateList: vi.fn(),
    deleteList: vi.fn(async () => ({ ok: true as const, data: null })),
    send: vi.fn(async () => ({ ok: true as const, data: { ok: true as const, messageId: 'm1' } })),
    uploadMedia: vi.fn(async (file: File) => ({ ok: true as const, data: { id: 'img1', mimeType: 'image/png' as const, size: file.size } })),
    templates: vi.fn(async () => ({ ok: true as const, data: { templates: [TEMPLATE] } })),
    createTemplate: vi.fn(async (input: MessageTemplateInput) => ({ ok: true as const, data: { ...TEMPLATE, id: 't2', name: input.name, body: input.body, variations: input.variations ?? [], mediaId: input.mediaId ?? null, ctaText: input.ctaText ?? null, ctaUrl: input.ctaUrl ?? null } })),
    updateTemplate: vi.fn(),
    deleteTemplate: vi.fn(async () => ({ ok: true as const, data: null })),
    ...overrides,
  } as MessagingApi;
}

const instantWait: Wait = async () => 0;

async function open({ session = OWNER, whatsapp = whatsappFake(), messaging = messagingFake(), readSpreadsheet, wait = instantWait }: { session?: SessionInfo; whatsapp?: WhatsAppApi; messaging?: MessagingApi; readSpreadsheet?: ReadSpreadsheet; wait?: Wait } = {}) {
  const authApi = { getSession: vi.fn(async () => session), signIn: vi.fn(), signUp: vi.fn(), signOut: vi.fn(async () => {}) } as unknown as AuthApi;
  render(
    <MemoryRouter initialEntries={['/envio-de-mensagens']}>
      <App authApi={authApi} whatsappApi={whatsapp} messagingApi={messaging} sendWait={wait} {...(readSpreadsheet ? { readSpreadsheet } : {})} fetchHealth={async () => ({ status: 'ok', service: 'x', timestamp: '2026-11-01T00:00:00.000Z' })} fetchReady={async () => true} />
    </MemoryRouter>,
  );
  await screen.findByRole('heading', { level: 1, name: 'Envio de Mensagens' });
  return { whatsapp, messaging };
}

const next = () => fireEvent.click(screen.getByRole('button', { name: 'Próximo →' }));
const stepTitle = () => screen.getByRole('heading', { level: 2 }).textContent;
const instanceSelect = () => screen.getByRole('combobox', { name: 'Instância' }) as HTMLSelectElement;

async function addContact(name: string, phone: string) {
  fireEvent.change(screen.getByLabelText('Nome do contato'), { target: { value: name } });
  fireEvent.change(screen.getByLabelText('Telefone com DDI'), { target: { value: phone } });
  fireEvent.click(screen.getByRole('button', { name: /Adicionar$/ }));
}

/** Etapas 1 a 4 preenchidas com a lista salva; para na etapa 5 */
async function prepareToSend(message = 'Olá {nome}!') {
  await waitFor(() => expect(instanceSelect().value).toBe('i1'));
  next();
  await act(async () => {
    fireEvent.change(screen.getByLabelText('Lista salva'), { target: { value: 'l1' } });
  });
  await screen.findByText('Bruno');
  next();
  fireEvent.change(screen.getByLabelText(/Mensagem principal/), { target: { value: message } });
  next();
  next();
  expect(stepTitle()).toBe('Disparar');
}

describe('Envio de Mensagens', () => {
  it('fica no menu depois de Campanhas e abre o assistente de 5 etapas', async () => {
    await open();
    const nav = screen.getByRole('navigation', { name: 'Etapas do disparo' });
    expect(within(nav).getAllByRole('button').map((b) => b.textContent)).toEqual(['1Instância', '2Contatos', '3Mensagem', '4Intervalo', '5Disparar']);
    expect(stepTitle()).toBe('Instância');
    expect(screen.getByText(/token da instância fica guardado com segurança no servidor/)).toBeTruthy();
  });

  it('etapa 1: escolhe a instância conectada; uma desconectada não deixa avançar', async () => {
    await open({ whatsapp: whatsappFake([OFFLINE, CONNECTED]) });
    await waitFor(() => expect(instanceSelect().value).toBe('i1'));
    expect(screen.getByRole('status').textContent).toContain('Conectado');
    fireEvent.change(instanceSelect(), { target: { value: 'i2' } });
    expect(screen.getByRole('status').textContent).toContain('Desconectado');
    next();
    expect(screen.getByRole('alert').textContent).toContain('não está conectada');
    expect(stepTitle()).toBe('Instância');
  });

  it('etapa 1: sem instância, aponta para a página WhatsApp', async () => {
    await open({ whatsapp: whatsappFake([]) });
    expect((await screen.findByRole('link', { name: /Crie e conecte uma em Integrações/ })).getAttribute('href')).toBe('/integracoes#whatsapp');
  });

  it('etapa 2: adiciona à mão com a regra de telefone e salva como lista da empresa', async () => {
    const { messaging } = await open();
    await waitFor(() => expect(instanceSelect().value).toBe('i1'));
    next();
    await addContact('Ana', '11988887777');
    expect(screen.getByRole('alert').textContent).toContain('DDI 55');
    await addContact('Ana', '+55 (11) 98888-7777');
    expect(screen.getByText('Ana')).toBeTruthy();
    expect(screen.getByLabelText('1 contatos')).toBeTruthy();
    await addContact('Repetida', '5511988887777');
    expect(screen.getByRole('alert').textContent).toContain('já está na lista');

    fireEvent.change(screen.getByLabelText('Nome da lista'), { target: { value: 'Clientes VIP' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Salvar lista/ }));
    });
    expect(messaging.createList).toHaveBeenCalledWith('Clientes VIP', [{ name: 'Ana', phone: '5511988887777' }]);
    expect(screen.getAllByRole('status').some((el) => el.textContent?.includes('Lista "Clientes VIP" salva com 1 contato.'))).toBe(true);
    expect(messaging.lists).toHaveBeenCalledTimes(2);
  });

  it('etapa 2: usa uma lista salva e pede confirmação antes de descartar alterações', async () => {
    const { messaging } = await open();
    await waitFor(() => expect(instanceSelect().value).toBe('i1'));
    next();
    await addContact('Avulso', '5541988887777');
    fireEvent.change(screen.getByLabelText('Lista salva'), { target: { value: 'l1' } });
    expect(screen.getByRole('alertdialog', { name: 'Confirmar troca de lista' })).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Trocar mesmo assim' }));
    });
    expect(messaging.getList).toHaveBeenCalledWith('l1');
    expect(screen.getByText('Bruno')).toBeTruthy();
    expect(screen.queryByText('Avulso')).toBeNull();
    expect(screen.getByLabelText('3 contatos')).toBeTruthy();
  });

  it('etapa 2: importa planilha com detecção das colunas e o motivo das linhas ignoradas', async () => {
    const readSpreadsheet = vi.fn<ReadSpreadsheet>(async () => ({
      fileName: 'clientes.xlsx',
      ncols: 2,
      rows: [['Nome', 'Celular'], ['Ana', 5511988887777], ['Bruno', '11988887777'], ['Carla', '']],
    }));
    await open({ readSpreadsheet });
    await waitFor(() => expect(instanceSelect().value).toBe('i1'));
    next();
    fireEvent.click(screen.getByRole('tab', { name: /Excel/ }));
    await act(async () => {
      fireEvent.change(screen.getByTestId('spreadsheet-input'), { target: { files: [new File(['x'], 'clientes.xlsx')] } });
    });
    expect(screen.getByText('clientes.xlsx')).toBeTruthy();
    expect((screen.getByLabelText('Coluna do telefone') as HTMLSelectElement).value).toBe('1');
    expect((screen.getByLabelText('Coluna do nome') as HTMLSelectElement).value).toBe('0');
    expect(screen.getByText('1 de 3 linhas com telefone válido')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Importar contatos' }));
    });
    const note = screen.getAllByRole('status').find((el) => el.textContent?.includes('Importação concluída'));
    expect(note?.textContent).toContain('1 contato adicionado, 2 linhas ignoradas (1 sem DDI, 1 vazio)');
    expect(screen.getByText('Ana')).toBeTruthy();
  });

  it('etapas 3 e 4: mensagem obrigatória, pré-visualização com {nome}, variações e intervalo validado', async () => {
    await open();
    await waitFor(() => expect(instanceSelect().value).toBe('i1'));
    next();
    await addContact('Ana', '5511988887777');
    next();
    next();
    expect(screen.getByRole('alert').textContent).toContain('Escreva a mensagem principal');
    fireEvent.change(screen.getByLabelText(/Mensagem principal/), { target: { value: 'Olá {nome}! *Promoção* hoje' } });
    expect(screen.getByText('27 caracteres')).toBeTruthy();
    const preview = screen.getByRole('complementary', { name: 'Pré-visualização' });
    expect(preview.textContent).toContain('Olá Ana! Promoção hoje');
    expect(preview.querySelector('.phone__text strong')?.textContent).toBe('Promoção');
    fireEvent.click(screen.getByRole('checkbox', { name: /Variações da mensagem/ }));
    expect(screen.getByLabelText('Variação B')).toBeTruthy();

    next();
    expect(stepTitle()).toBe('Intervalo entre envios');
    fireEvent.change(screen.getByLabelText('Tempo mínimo (segundos)'), { target: { value: '0' } });
    expect(screen.getByRole('alert').textContent).toContain('pelo menos 1 segundo');
    fireEvent.change(screen.getByLabelText('Tempo mínimo (segundos)'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Tempo máximo (segundos)'), { target: { value: '6' } });
    expect(screen.getByRole('note').textContent).toContain('risco de banimento');
    next();
    expect(stepTitle()).toBe('Disparar');
  });

  it('etapa 3: imagem, mensagem e CTA nesta ordem; a pré-visualização mostra o que o contato recebe', async () => {
    const { messaging } = await open();
    await waitFor(() => expect(instanceSelect().value).toBe('i1'));
    next();
    await addContact('Ana', '5511988887777');
    next();
    const titles = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent ?? '');
    expect(titles.map((t) => t.replace(/^\d\s*/, '').split(' ')[0])).toEqual(['Imagem', 'Mensagem', 'CTA']);

    // Imagem: formato errado nem chega à API; PNG sobe e aparece no celular
    await act(async () => {
      fireEvent.change(screen.getByTestId('image-input'), { target: { files: [new File(['%PDF'], 'contrato.pdf', { type: 'application/pdf' })] } });
    });
    expect(screen.getByRole('alert').textContent).toContain('JPG, PNG ou WebP');
    expect(messaging.uploadMedia).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.change(screen.getByTestId('image-input'), { target: { files: [new File(['png'], 'promo.png', { type: 'image/png' })] } });
    });
    expect(messaging.uploadMedia).toHaveBeenCalledTimes(1);
    expect((screen.getByAltText('Imagem escolhida para a mensagem') as HTMLImageElement).getAttribute('src')).toBe('/api/internal/media/img1');

    fireEvent.change(screen.getByLabelText(/Mensagem principal/), { target: { value: 'Olá {nome}!' } });
    fireEvent.change(screen.getByLabelText('Texto do CTA'), { target: { value: 'Quero aproveitar' } });
    fireEvent.change(screen.getByLabelText('Link'), { target: { value: 'loja.exemplo.test' } });
    next();
    expect(screen.getAllByRole('alert').some((el) => el.textContent?.includes('https://'))).toBe(true);
    fireEvent.change(screen.getByLabelText('Link'), { target: { value: 'https://loja.exemplo.test/promo' } });
    const preview = screen.getByRole('complementary', { name: 'Pré-visualização' });
    expect(preview.querySelector('img')?.getAttribute('src')).toBe('/api/internal/media/img1');
    expect(preview.textContent).toContain('Olá Ana!👉 Quero aproveitar: https://loja.exemplo.test/promo'.replace('!👉', '!\n\n👉'));
    expect(preview.querySelector('.wa-link')?.textContent).toBe('https://loja.exemplo.test/promo');
    next();
    expect(stepTitle()).toBe('Intervalo entre envios');
  });

  it('etapa 3: salva o modelo da empresa e reaproveita um modelo salvo', async () => {
    const { messaging } = await open();
    await waitFor(() => expect(instanceSelect().value).toBe('i1'));
    next();
    await addContact('Ana', '5511988887777');
    next();
    fireEvent.change(screen.getByLabelText(/Mensagem principal/), { target: { value: 'Oi {nome}, novidade!' } });
    fireEvent.change(screen.getByLabelText('Texto do CTA'), { target: { value: 'Ver ofertas' } });
    fireEvent.change(screen.getByLabelText('Link'), { target: { value: 'https://loja.exemplo.test' } });
    fireEvent.change(screen.getByLabelText('Nome do modelo'), { target: { value: 'Novidades' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Salvar modelo/ }));
    });
    expect(messaging.createTemplate).toHaveBeenCalledWith({ name: 'Novidades', body: 'Oi {nome}, novidade!', variations: [], mediaId: null, ctaText: 'Ver ofertas', ctaUrl: 'https://loja.exemplo.test' });
    expect(screen.getAllByRole('status').some((el) => el.textContent?.includes('Modelo "Novidades" salvo'))).toBe(true);
    expect(messaging.templates).toHaveBeenCalledTimes(2);

    // Trocar para um modelo salvo pede confirmação só se houver alteração não salva
    fireEvent.change(screen.getByLabelText(/Mensagem principal/), { target: { value: 'Alterado' } });
    fireEvent.change(screen.getByLabelText('Modelo salvo'), { target: { value: 't1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Trocar mesmo assim' }));
    expect((screen.getByLabelText(/Mensagem principal/) as HTMLTextAreaElement).value).toBe('Olá {nome}! *20% de desconto*');
    expect((screen.getByLabelText('Texto do CTA') as HTMLInputElement).value).toBe('Quero aproveitar');
    expect((screen.getByAltText('Imagem escolhida para a mensagem') as HTMLImageElement).getAttribute('src')).toBe('/api/internal/media/img-salva');
  });

  it('etapa 5: com modelo de imagem e CTA, cada envio leva a imagem e a linha do CTA', async () => {
    const messaging = messagingFake();
    await open({ messaging });
    await waitFor(() => expect(instanceSelect().value).toBe('i1'));
    next();
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Lista salva'), { target: { value: 'l1' } });
    });
    await screen.findByText('Bruno');
    next();
    await waitFor(() => expect(screen.getByLabelText('Modelo salvo').querySelectorAll('option')).toHaveLength(2));
    fireEvent.change(screen.getByLabelText('Modelo salvo'), { target: { value: 't1' } });
    next();
    next();
    expect(screen.getByText('Imagem + Texto + CTA')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Iniciar disparo/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Confirmar e iniciar/ }));
    });
    await screen.findByRole('region', { name: 'Resumo do disparo' });
    expect(messaging.send).toHaveBeenNthCalledWith(1, 'i1', '5511988887777', 'Olá Ana! *20% de desconto*\n\n👉 Quero aproveitar: https://loja.exemplo.test/promo', 'img-salva');
    expect(messaging.send).toHaveBeenNthCalledWith(3, 'i1', '5531988887777', 'Olá! *20% de desconto*\n\n👉 Quero aproveitar: https://loja.exemplo.test/promo', 'img-salva');
  });

  it('etapa 5: envia para cada contato com o texto personalizado; número recusado não para o disparo', async () => {
    const results: SendTextResult[] = [
      { ok: true, messageId: 'm1' },
      { ok: false, reason: 'invalid_number', message: 'Número não aceito pelo WhatsApp (inexistente ou sem WhatsApp).', stop: false },
      { ok: true, messageId: 'm3' },
    ];
    const messaging = messagingFake({ send: vi.fn(async () => ({ ok: true as const, data: results.shift() as SendTextResult })) });
    await open({ messaging });
    await prepareToSend('Olá {nome}!');
    fireEvent.click(screen.getByRole('button', { name: /Iniciar disparo/ }));
    expect(screen.getByRole('alertdialog', { name: 'Confirmar disparo' }).textContent).toContain('3 contato(s)');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Confirmar e iniciar/ }));
    });
    const summary = await screen.findByRole('region', { name: 'Resumo do disparo' });
    expect(messaging.send).toHaveBeenNthCalledWith(1, 'i1', '5511988887777', 'Olá Ana!', null);
    expect(messaging.send).toHaveBeenNthCalledWith(2, 'i1', '5521998765432', 'Olá Bruno!', null);
    expect(messaging.send).toHaveBeenNthCalledWith(3, 'i1', '5531988887777', 'Olá!', null);
    expect(within(summary).getByText('Enviados').nextSibling?.textContent).toBe('2');
    expect(within(summary).getByText('Erros').nextSibling?.textContent).toBe('1');
    const log = screen.getByLabelText('Log do disparo').textContent ?? '';
    expect(log).toContain('Número não aceito pelo WhatsApp');
    expect(log).toContain('Disparo concluído: 2 enviado(s), 1 erro(s).');
  });

  it('etapa 5: instância desconectada interrompe na hora, com o motivo', async () => {
    const messaging = messagingFake({
      send: vi.fn(async () => ({ ok: true as const, data: { ok: false as const, reason: 'instance_disconnected' as const, message: 'O WhatsApp desta instância está desconectado.', stop: true } })),
    });
    const { whatsapp } = await open({ messaging });
    await prepareToSend();
    fireEvent.click(screen.getByRole('button', { name: /Iniciar disparo/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Confirmar e iniciar/ }));
    });
    const summary = await screen.findByRole('region', { name: 'Resumo do disparo' });
    expect(messaging.send).toHaveBeenCalledTimes(1);
    expect(within(summary).getByRole('alert').textContent).toContain('Disparo interrompido: O WhatsApp desta instância está desconectado.');
    await waitFor(() => expect(whatsapp.list).toHaveBeenCalledTimes(2));
  });

  it('etapa 5: "Parar" interrompe no intervalo entre um envio e outro', async () => {
    // Espera que só termina quando alguém pede para parar
    const waitUntilStop: Wait = async (_ms, shouldStop) => {
      while (!shouldStop()) await new Promise((resolve) => setTimeout(resolve, 5));
      return 1;
    };
    const messaging = messagingFake();
    await open({ messaging, wait: waitUntilStop });
    await prepareToSend();
    fireEvent.click(screen.getByRole('button', { name: /Iniciar disparo/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Confirmar e iniciar/ }));
    });
    await waitFor(() => expect(messaging.send).toHaveBeenCalledTimes(1));
    expect((screen.getByRole('button', { name: '← Voltar' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /Parar/ }));
    const summary = await screen.findByRole('region', { name: 'Resumo do disparo' });
    expect(within(summary).getByRole('note').textContent).toContain('2 de 3 contato(s) não foram processados');
    expect(messaging.send).toHaveBeenCalledTimes(1);
  });

  it('quem só visualiza não inicia o disparo nem salva listas', async () => {
    await open({ messaging: messagingFake({}, false) });
    await waitFor(() => expect(instanceSelect().value).toBe('i1'));
    next();
    expect(screen.queryByRole('button', { name: /Salvar lista/ })).toBeNull();
    expect(screen.getByText(/Só o dono, os administradores e os operadores salvam e enviam/)).toBeTruthy();
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Lista salva'), { target: { value: 'l1' } });
    });
    next();
    fireEvent.change(screen.getByLabelText(/Mensagem principal/), { target: { value: 'Oi' } });
    next();
    next();
    expect((screen.getByRole('button', { name: /Iniciar disparo/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('Super-Admin sem empresa: explica que o envio é das empresas', async () => {
    await open({ session: SUPER_NO_ORG });
    expect(screen.getByText(/Sua conta não está ligada a uma empresa/)).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: 'Etapas do disparo' })).toBeNull();
  });
});
