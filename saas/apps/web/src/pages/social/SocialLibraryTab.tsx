import { ImageOff, Search, Trash2, Upload } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { mediaPath, type SocialLibrary, type SocialLibraryItem } from '@disparazap/contracts';
import { normalizeText } from '../ContactsPage';
import type { SocialApi } from '../../social/social-api';

const TYPE_LABELS: Readonly<Record<string, string>> = { 'image/jpeg': 'JPG', 'image/png': 'PNG', 'image/webp': 'WebP' };
const formatSize = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/** Biblioteca de mídia da empresa: as mesmas imagens do Envio de Mensagens, reutilizáveis nas publicações */
export function SocialLibraryTab({ api }: { api: SocialApi }) {
  const [library, setLibrary] = useState<SocialLibrary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [type, setType] = useState('');
  const [uploading, setUploading] = useState(false);
  const [toDelete, setToDelete] = useState<SocialLibraryItem | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      const result = await api.library(signal);
      if (signal?.aborted) return;
      if (!result.ok) return setError(result.message);
      setLibrary(result.data);
    },
    [api],
  );
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const visible = useMemo(() => {
    const wanted = normalizeText(query.trim());
    return (library?.items ?? []).filter((item) => (!type || item.mimeType === type) && (!wanted || normalizeText(item.fileName ?? '').includes(wanted)));
  }, [library, query, type]);

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])];
    event.target.value = '';
    if (!files.length) return;
    setUploading(true);
    setError(null);
    setNote(null);
    let sent = 0;
    for (const file of files) {
      const result = await api.uploadMedia(file);
      if (!result.ok) {
        setError(`${file.name}: ${result.message}`);
        break;
      }
      sent += 1;
    }
    setUploading(false);
    if (sent) setNote(sent === 1 ? 'Imagem enviada.' : `${sent} imagens enviadas.`);
    void load();
  }

  async function remove(item: SocialLibraryItem) {
    setBusy(true);
    const result = await api.deleteMedia(item.id);
    setBusy(false);
    setToDelete(null);
    if (!result.ok) return setError(result.message);
    setError(null);
    setNote(`"${item.fileName ?? 'Imagem'}" excluída da biblioteca.`);
    void load();
  }

  return (
    <section className="card" aria-label="Biblioteca de mídia">
      <div className="contacts-toolbar">
        <div className="search-field">
          <Search aria-hidden="true" />
          <input type="search" className="field__input" aria-label="Buscar pelo nome do arquivo" placeholder="Buscar pelo nome do arquivo" value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>
        <select className="field__input field__input--small" aria-label="Filtrar por tipo" value={type} onChange={(event) => setType(event.target.value)}>
          <option value="">Todos os tipos</option>
          {Object.entries(TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        {library?.canUpload && (
          <>
            <button type="button" className="action-button action-button--primary" disabled={uploading} onClick={() => fileInput.current?.click()}>
              <Upload aria-hidden="true" /> {uploading ? 'Enviando…' : 'Enviar imagens'}
            </button>
            <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden aria-label="Enviar imagens para a biblioteca" onChange={(event) => void upload(event)} />
          </>
        )}
      </div>

      {error && <p className="auth-alert" role="alert">{error}</p>}
      {note && <p className="integration__success" role="status">{note}</p>}
      {toDelete && (
        <div className="instance__confirm" role="alertdialog" aria-label="Confirmar exclusão da imagem">
          <p>Excluir "{toDelete.fileName ?? 'esta imagem'}" da biblioteca? Publicações já feitas não mudam.</p>
          <div className="integration__actions">
            <button type="button" className="action-button action-button--danger" disabled={busy} onClick={() => void remove(toDelete)}>Excluir imagem</button>
            <button type="button" className="action-button" onClick={() => setToDelete(null)}>Cancelar</button>
          </div>
        </div>
      )}

      {!library ? (
        <p className="integration__loading">Carregando…</p>
      ) : library.items.length === 0 ? (
        <div className="empty-state">
          <ImageOff aria-hidden="true" />
          <strong>Biblioteca vazia</strong>
          <span>Imagens enviadas aqui, no Criar publicação ou no Envio de Mensagens ficam guardadas para reutilizar.</span>
        </div>
      ) : visible.length === 0 ? (
        <p className="field__hint">Nenhuma imagem com esses filtros.</p>
      ) : (
        <ul className="library-grid">
          {visible.map((item) => (
            <li key={item.id} className="library-grid__item">
              <img src={mediaPath(item.id)} alt={item.fileName ?? 'Imagem da biblioteca'} loading="lazy" />
              <div className="library-grid__info">
                <strong>{item.fileName ?? 'Imagem sem nome'}</strong>
                <small>
                  {TYPE_LABELS[item.mimeType] ?? item.mimeType} · {formatSize(item.size)} · {new Date(item.createdAt).toLocaleDateString('pt-BR')}
                </small>
                {item.usedByTemplate && <small className="library-grid__tag">Usada em modelo de mensagem</small>}
              </div>
              {library.canDelete && (
                <button type="button" className="icon-button icon-button--danger" aria-label={`Excluir ${item.fileName ?? 'imagem'}`} disabled={busy} onClick={() => setToDelete(item)}>
                  <Trash2 aria-hidden="true" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="field__hint">
        {library ? `${library.items.length} de ${library.limit} imagens. ` : ''}JPG, PNG ou WebP de até 5 MB. Vídeos chegam numa próxima etapa.
        {library && !library.canDelete ? ' Só o dono e os administradores excluem imagens.' : ''}
      </p>
    </section>
  );
}
