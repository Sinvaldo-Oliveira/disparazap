import { ImagePlus, Link2, MessageSquareText, Plus, RefreshCw, Save, Trash2, X } from 'lucide-react';
import { useRef, useState, type DragEvent } from 'react';
import {
  CTA_LIMITS,
  MEDIA_LIMITS,
  MESSAGING_LIMITS,
  TEMPLATE_LIMITS,
  composeMessage,
  ctaProblem,
  mediaPath,
  type Contact,
  type MessageTemplate,
} from '@disparazap/contracts';
import { formatPhone } from '../pages/WhatsAppPage';
import { formatWhatsApp, renderMessage } from './message-format';
import type { MessagingApi } from './messaging-api';

export interface Variation {
  id: number;
  text: string;
}

/** O que está sendo montado na etapa Mensagem (e o que um modelo salvo guarda) */
export interface MessageDraft {
  body: string;
  abEnabled: boolean;
  variations: Variation[];
  mediaId: string | null;
  ctaText: string;
  ctaUrl: string;
}

export const EMPTY_DRAFT: MessageDraft = { body: '', abEnabled: false, variations: [], mediaId: null, ctaText: '', ctaUrl: '' };

/** Modelo em uso: id null = modelo novo, ainda não salvo */
export interface SavedTemplateState {
  id: string | null;
  name: string;
  dirty: boolean;
}

export const NEW_TEMPLATE: SavedTemplateState = { id: null, name: '', dirty: false };

/** Textos que podem ser sorteados (principal + variações preenchidas) */
export const draftTexts = (draft: MessageDraft) => [draft.body, ...(draft.abEnabled ? draft.variations.map((variation) => variation.text) : [])].filter((text) => text.trim());

export const draftCta = (draft: MessageDraft) => (draft.ctaText.trim() && draft.ctaUrl.trim() ? { text: draft.ctaText, url: draft.ctaUrl } : null);

export function draftFromTemplate(template: MessageTemplate): MessageDraft {
  return {
    body: template.body,
    abEnabled: template.variations.length > 0,
    variations: template.variations.map((text, index) => ({ id: index + 1, text })),
    mediaId: template.mediaId,
    ctaText: template.ctaText ?? '',
    ctaUrl: template.ctaUrl ?? '',
  };
}

const letter = (index: number) => String.fromCharCode(65 + index);
const nextId = (variations: Variation[]) => variations.reduce((max, variation) => Math.max(max, variation.id), 0) + 1;

interface MessageStepProps {
  api: MessagingApi;
  draft: MessageDraft;
  onDraftChange: (draft: MessageDraft) => void;
  saved: SavedTemplateState;
  onSavedChange: (saved: SavedTemplateState) => void;
  templates: MessageTemplate[];
  onTemplatesChanged: () => void;
  canSave: boolean;
  previewContact: Contact;
}

export function MessageStep({ api, draft, onDraftChange, saved, onSavedChange, templates, onTemplatesChanged, canSave, previewContact }: MessageStepProps) {
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [confirm, setConfirm] = useState<'delete' | { switchTo: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const lastField = useRef<{ id: number | 'main'; element: HTMLTextAreaElement | null }>({ id: 'main', element: null });

  const feedback = (message: string | null, isError = false) => {
    setError(isError ? message : null);
    setNote(isError ? null : message);
  };
  const change = (patch: Partial<MessageDraft>) => onDraftChange({ ...draft, ...patch });

  // ----- Imagem -----
  async function chooseImage(file: File | undefined) {
    if (fileInput.current) fileInput.current.value = '';
    if (!file) return;
    feedback(null);
    if (!(MEDIA_LIMITS.mimeTypes as readonly string[]).includes(file.type)) return feedback('Use uma imagem JPG, PNG ou WebP.', true);
    if (file.size > MEDIA_LIMITS.maxBytes) return feedback('A imagem pode ter até 5 MB.', true);
    setUploading(true);
    const result = await api.uploadMedia(file);
    setUploading(false);
    if (!result.ok) return feedback(result.message, true);
    change({ mediaId: result.data.id });
  }

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    void chooseImage(event.dataTransfer.files[0]);
  };

  // ----- Mensagem -----
  function insertName() {
    const { id, element } = lastField.current;
    const current = id === 'main' ? draft.body : (draft.variations.find((variation) => variation.id === id)?.text ?? '');
    const start = element?.selectionStart ?? current.length;
    const end = element?.selectionEnd ?? start;
    const next = `${current.slice(0, start)}{nome}${current.slice(end)}`;
    if (id === 'main') change({ body: next });
    else change({ variations: draft.variations.map((variation) => (variation.id === id ? { ...variation, text: next } : variation)) });
    requestAnimationFrame?.(() => {
      element?.focus();
      element?.setSelectionRange(start + 6, start + 6);
    });
  }

  function toggleAb(on: boolean) {
    change({ abEnabled: on, variations: on && draft.variations.length === 0 ? [{ id: 1, text: '' }] : draft.variations });
  }

  // ----- Modelos salvos -----
  function loadTemplate(id: string) {
    setConfirm(null);
    feedback(null);
    const template = templates.find((candidate) => candidate.id === id);
    if (!template) {
      onDraftChange(EMPTY_DRAFT);
      onSavedChange(NEW_TEMPLATE);
      return;
    }
    onDraftChange(draftFromTemplate(template));
    onSavedChange({ id: template.id, name: template.name, dirty: false });
    feedback(`Modelo "${template.name}" carregado.`);
  }

  function chooseTemplate(id: string) {
    if (saved.dirty && (draft.body.trim() || draft.mediaId)) return setConfirm({ switchTo: id });
    loadTemplate(id);
  }

  async function saveTemplate() {
    feedback(null);
    const name = saved.name.trim();
    if (name.length < 2) return feedback('Dê um nome ao modelo antes de salvar (ex.: "Promoção de novembro").', true);
    if (!draft.body.trim()) return feedback('Escreva a mensagem principal antes de salvar o modelo.', true);
    const ctaError = ctaProblem(draft.ctaText, draft.ctaUrl);
    if (ctaError) return feedback(ctaError, true);
    const input = {
      name,
      body: draft.body,
      variations: draft.abEnabled ? draft.variations.map((variation) => variation.text).filter((text) => text.trim()) : [],
      mediaId: draft.mediaId,
      ctaText: draft.ctaText.trim() || null,
      ctaUrl: draft.ctaUrl.trim() || null,
    };
    setBusy(true);
    const result = saved.id ? await api.updateTemplate(saved.id, input) : await api.createTemplate(input);
    setBusy(false);
    if (!result.ok) return feedback(result.message, true);
    onSavedChange({ id: result.data.id, name: result.data.name, dirty: false });
    onTemplatesChanged();
    feedback(`Modelo "${result.data.name}" salvo. Ele fica disponível para os próximos disparos da empresa.`);
  }

  async function deleteTemplate() {
    if (!saved.id) return;
    setConfirm(null);
    setBusy(true);
    const result = await api.deleteTemplate(saved.id);
    setBusy(false);
    if (!result.ok) return feedback(result.message, true);
    onSavedChange({ id: null, name: saved.name, dirty: true });
    onTemplatesChanged();
    feedback(`Modelo "${saved.name}" excluído. O conteúdo continua nesta tela.`);
  }

  const ctaError = ctaProblem(draft.ctaText, draft.ctaUrl);
  const cta = draftCta(draft);
  const texts = draftTexts(draft);
  const pendingSwitch = confirm && typeof confirm === 'object' ? confirm.switchTo : null;
  const name = previewContact.name;

  return (
    <div className="composer">
      <div className="composer__editor">
        <section className="list-bar" aria-label="Modelo de mensagem">
          <div className="list-bar__row">
            <div className="field">
              <label className="field__label" htmlFor="saved-template">Modelo salvo</label>
              <select id="saved-template" className="field__input" value={saved.id ?? ''} disabled={busy} onChange={(event) => chooseTemplate(event.target.value)}>
                <option value="">— Novo modelo (não salvo) —</option>
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>{template.name}</option>
                ))}
              </select>
            </div>
            {canSave && (
              <div className="field">
                <label className="field__label" htmlFor="template-name">Nome do modelo</label>
                <input id="template-name" className="field__input" maxLength={TEMPLATE_LIMITS.nameMax} placeholder="Ex.: Promoção de novembro" value={saved.name} disabled={busy} onChange={(event) => onSavedChange({ ...saved, name: event.target.value, dirty: true })} />
              </div>
            )}
          </div>
          <div className="integration__actions">
            {canSave && (
              <button type="button" className="action-button action-button--primary" disabled={busy} onClick={() => void saveTemplate()}>
                <Save aria-hidden="true" /> {saved.id ? 'Salvar alterações do modelo' : 'Salvar modelo'}
              </button>
            )}
            {canSave && saved.id && (
              <button type="button" className="action-button action-button--danger" disabled={busy} onClick={() => setConfirm('delete')}>
                <Trash2 aria-hidden="true" /> Excluir modelo
              </button>
            )}
            <span className="field__hint" role="status">{saved.id ? (saved.dirty ? 'Alterações não salvas' : 'Modelo salvo') : ''}</span>
          </div>
          {confirm === 'delete' && (
            <div className="instance__confirm" role="alertdialog" aria-label="Confirmar exclusão do modelo">
              <p>Excluir o modelo "{saved.name}"? Os disparos já feitos não mudam.</p>
              <div className="integration__actions">
                <button type="button" className="action-button action-button--danger" onClick={() => void deleteTemplate()}>Excluir modelo</button>
                <button type="button" className="action-button" onClick={() => setConfirm(null)}>Cancelar</button>
              </div>
            </div>
          )}
          {pendingSwitch !== null && (
            <div className="instance__confirm" role="alertdialog" aria-label="Confirmar troca de modelo">
              <p>A mensagem desta tela tem alterações não salvas. Trocar de modelo descarta essas alterações.</p>
              <div className="integration__actions">
                <button type="button" className="action-button action-button--danger" onClick={() => loadTemplate(pendingSwitch)}>Trocar mesmo assim</button>
                <button type="button" className="action-button" onClick={() => setConfirm(null)}>Cancelar</button>
              </div>
            </div>
          )}
        </section>

        {error && <p className="auth-alert" role="alert">{error}</p>}
        {note && <p className="integration__success" role="status">{note}</p>}

        <section className="composer__section" aria-labelledby="composer-image">
          <h3 id="composer-image" className="composer__title">
            <span className="composer__num" aria-hidden="true">1</span> Imagem <span className="composer__optional">opcional</span>
          </h3>
          {draft.mediaId ? (
            <div className="image-field">
              <img src={mediaPath(draft.mediaId)} alt="Imagem escolhida para a mensagem" />
              <div className="image-field__actions">
                <p className="field__hint">Com imagem, o texto da mensagem vai como legenda.</p>
                <div className="integration__actions">
                  <button type="button" className="action-button" disabled={uploading} onClick={() => fileInput.current?.click()}>
                    <RefreshCw aria-hidden="true" /> Trocar imagem
                  </button>
                  <button type="button" className="action-button action-button--danger" onClick={() => change({ mediaId: null })}>
                    <X aria-hidden="true" /> Remover imagem
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div
              className={`dropzone dropzone--compact${dragging ? ' dropzone--over' : ''}`}
              role="button"
              tabIndex={0}
              aria-label="Escolher imagem"
              onClick={() => fileInput.current?.click()}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  fileInput.current?.click();
                }
              }}
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
            >
              <ImagePlus aria-hidden="true" />
              <strong>{uploading ? 'Enviando a imagem…' : 'Arraste a imagem aqui ou clique para escolher'}</strong>
              <small>JPG, PNG ou WebP, até 5 MB. Uma imagem por mensagem.</small>
            </div>
          )}
          <input ref={fileInput} type="file" accept={MEDIA_LIMITS.mimeTypes.join(',')} hidden data-testid="image-input" onChange={(event) => void chooseImage(event.target.files?.[0])} />
        </section>

        <section className="composer__section" aria-labelledby="composer-message">
          <div className="wizard__label-row">
            <h3 id="composer-message" className="composer__title">
              <span className="composer__num" aria-hidden="true">2</span> Mensagem {draft.abEnabled && <span className="badge badge--neutral">Variação A</span>}
            </h3>
            <button type="button" className="action-button" onClick={insertName}>
              <Plus aria-hidden="true" /> {'{nome}'}
            </button>
          </div>
          <label className="sr-only" htmlFor="message-main">Mensagem principal</label>
          <textarea
            id="message-main"
            className="field__input wizard__textarea"
            placeholder="Olá {nome}! Tudo bem? Temos uma novidade para você…"
            value={draft.body}
            onFocus={(event) => (lastField.current = { id: 'main', element: event.currentTarget })}
            onChange={(event) => change({ body: event.target.value })}
          />
          <div className="wizard__foot">
            <span className="field__hint">Use {'{nome}'} para o nome do contato. Formatação do WhatsApp: *negrito*, _itálico_, ~riscado~</span>
            <span className="field__hint">{draft.body.length} {draft.body.length === 1 ? 'caractere' : 'caracteres'}</span>
          </div>
        </section>

        <section className="composer__section" aria-labelledby="composer-cta">
          <h3 id="composer-cta" className="composer__title">
            <span className="composer__num" aria-hidden="true">3</span> CTA <span className="composer__optional">chamada para ação · opcional</span>
          </h3>
          <div className="cta-grid">
            <div className="field">
              <label className="field__label" htmlFor="cta-text">Texto do CTA</label>
              <input id="cta-text" className="field__input" maxLength={CTA_LIMITS.textMax} placeholder="Ex.: Quero aproveitar" value={draft.ctaText} onChange={(event) => change({ ctaText: event.target.value })} />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="cta-url">Link</label>
              <input id="cta-url" className="field__input" inputMode="url" maxLength={CTA_LIMITS.urlMax} placeholder="https://sualoja.com/promo" value={draft.ctaUrl} aria-invalid={Boolean(ctaError && draft.ctaUrl.trim())} onChange={(event) => change({ ctaUrl: event.target.value })} />
            </div>
          </div>
          <p className="field__hint">
            <Link2 aria-hidden="true" className="inline-icon" /> Vai no fim da mensagem, numa linha: <strong>👉 {draft.ctaText.trim() || 'Texto do CTA'}: {draft.ctaUrl.trim() || 'link'}</strong>. Também funciona com links de WhatsApp (https://wa.me/…).
          </p>
          {ctaError && (draft.ctaText.trim() || draft.ctaUrl.trim()) && <p className="field__error">{ctaError}</p>}
        </section>

        <section className="ab">
          <label className="checkbox">
            <input type="checkbox" checked={draft.abEnabled} onChange={(event) => toggleAb(event.target.checked)} /> <strong>Variações da mensagem (Teste A/B)</strong>
          </label>
          <p className="field__hint">A cada envio o sistema sorteia uma variação; a mensagem principal é a variação A. Imagem e CTA valem para todas.</p>
          {draft.abEnabled && (
            <div className="ab__list">
              {draft.variations.map((variation, index) => (
                <div className="field" key={variation.id}>
                  <div className="wizard__label-row">
                    <label className="field__label" htmlFor={`variation-${variation.id}`}>Variação {letter(index + 1)}</label>
                    <button type="button" className="action-button action-button--danger" onClick={() => change({ variations: draft.variations.filter((v) => v.id !== variation.id) })}>
                      <X aria-hidden="true" /> Remover
                    </button>
                  </div>
                  <textarea
                    id={`variation-${variation.id}`}
                    className="field__input wizard__textarea"
                    placeholder="Outra forma de dizer a mesma coisa… use {nome}"
                    value={variation.text}
                    onFocus={(event) => (lastField.current = { id: variation.id, element: event.currentTarget })}
                    onChange={(event) => change({ variations: draft.variations.map((v) => (v.id === variation.id ? { ...v, text: event.target.value } : v)) })}
                  />
                </div>
              ))}
              {draft.variations.length < TEMPLATE_LIMITS.variationsMax && (
                <button type="button" className="action-button" onClick={() => change({ variations: [...draft.variations, { id: nextId(draft.variations), text: '' }] })}>
                  <Plus aria-hidden="true" /> Adicionar variação
                </button>
              )}
            </div>
          )}
        </section>
      </div>

      <aside className="composer__preview" aria-label="Pré-visualização">
        <p className="composer__preview-title">
          <MessageSquareText aria-hidden="true" /> Como {name || 'o contato'} vai receber
        </p>
        <div className="phone">
          <div className="phone__bar">
            <span className="phone__avatar" aria-hidden="true">{(name || '?').slice(0, 1).toUpperCase()}</span>
            <span>
              <strong>{name || 'Contato Exemplo'}</strong>
              <small>{formatPhone(previewContact.phone)}</small>
            </span>
          </div>
          <div className="phone__chat">
            {texts.length === 0 && !draft.mediaId ? (
              <p className="phone__empty">A mensagem aparece aqui enquanto você escreve.</p>
            ) : (
              (texts.length ? texts : ['']).map((text, index) => {
                const full = composeMessage(renderMessage(text, name), cta);
                return (
                  <div className="phone__bubble" key={index}>
                    {texts.length > 1 && <span className="preview__tag">Variação {letter(index)}</span>}
                    {draft.mediaId && <img className="phone__image" src={mediaPath(draft.mediaId)} alt="" />}
                    {full && <span className="phone__text">{formatWhatsApp(full)}</span>}
                    <span className="phone__time">14:02 ✓✓</span>
                    {full.length > MESSAGING_LIMITS.messageMax && <span className="field__error">Passa de {MESSAGING_LIMITS.messageMax} caracteres.</span>}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}
