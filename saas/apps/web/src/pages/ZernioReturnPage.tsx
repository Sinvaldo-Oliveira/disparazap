import { LoaderCircle } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { ZERNIO_RETURN_PARAM } from '@disparazap/contracts';
import type { NavigationItem } from '../app/navigation';
import { useSession } from '../auth/AuthProvider';
import { PageHeader } from '../components/PageHeader';
import type { ZernioApi } from '../integrations/zernio-api';
import type { ZernioResultState } from './IntegrationsPage';

const MISSING_RECEIPT = 'O retorno da Zernio chegou sem o comprovante da conexão. Tente conectar de novo por esta página.';

// Os limites do contrato: valores maiores viriam de um endereço adulterado
const param = (params: URLSearchParams, name: string, max: number) => {
  const value = params.get(name);
  return value ? value.slice(0, max) : null;
};

/**
 * Volta da autorização na Zernio (/integracoes/zernio/retorno?dz=…&connected=…&accountId=…).
 * Repassa à API só o comprovante e os campos conhecidos; a API confere tudo e relê as contas na Zernio.
 * Depois volta para Integrações com a mensagem, tirando os parâmetros do endereço.
 */
export function ZernioReturnPage({ item, api }: { item: NavigationItem; api: ZernioApi }) {
  const session = useSession();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const started = useRef(false);

  useEffect(() => {
    // Uma vez só: o comprovante não deve ser usado duas vezes (o React em modo estrito roda efeitos em dobro)
    if (started.current) return;
    started.current = true;
    const back = (zernioResult: NonNullable<ZernioResultState['zernioResult']>) =>
      navigate(item.path, { replace: true, state: { zernioResult } satisfies ZernioResultState });

    if (!session.organization) {
      back({ ok: false, message: 'Sua conta não está ligada a uma empresa.' });
      return;
    }
    const dz = param(params, ZERNIO_RETURN_PARAM, 200);
    if (!dz) {
      back({ ok: false, message: MISSING_RECEIPT });
      return;
    }
    void api
      .completeConnect({ dz, connected: param(params, 'connected', 40), accountId: param(params, 'accountId', 100), error: param(params, 'error', 100) })
      .then((response) => back(response.ok ? { ok: response.data.ok, message: response.data.message } : { ok: false, message: response.message }));
  }, [api, item.path, navigate, params, session.organization]);

  return (
    <>
      <PageHeader title={item.label} icon={item.icon} />
      <div className="zernio-return" role="status">
        <LoaderCircle className="auth-status__icon auth-status__icon--spin" aria-hidden="true" />
        <p>Concluindo a conexão…</p>
      </div>
    </>
  );
}
