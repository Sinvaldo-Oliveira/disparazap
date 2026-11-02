import { ArrowRight, ChevronRight } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { SIGNUP_ROUTE, safeReturnPath } from '../auth/guards';
import { BrandMark } from '../components/BrandMark';
import { PasswordField } from '../components/PasswordField';

export function LoginPage() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    const result = await signIn({ email: email.trim(), password, rememberMe });
    setSubmitting(false);
    if (result.ok) navigate(safeReturnPath(params.get('voltar')), { replace: true });
    else setError(result.message);
  }

  return (
    <div className="auth-form">
      <div className="auth-form__header">
        <span className="auth-form__icon"><BrandMark size={52} /></span>
        <h1 className="auth-form__title">Entre na sua conta</h1>
        <p className="auth-form__subtitle">Use seu e-mail e sua senha para acessar o painel.</p>
      </div>

      <form className="auth-form__body" onSubmit={handleSubmit}>
        <div className="field">
          <label className="field__label" htmlFor="login-email">E-mail</label>
          <input
            id="login-email"
            className="field__input"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            required
            aria-invalid={error ? true : undefined}
          />
        </div>

        <PasswordField label="Senha" value={password} onChange={setPassword} autoComplete="current-password" invalid={Boolean(error)} />

        <label className="checkbox">
          <input type="checkbox" checked={rememberMe} onChange={(event) => setRememberMe(event.target.checked)} />
          <span>Lembrar de mim</span>
        </label>

        {error && <p className="auth-alert" role="alert">{error}</p>}

        <button type="submit" className="auth-button" disabled={submitting}>
          {submitting ? 'Entrando…' : 'Entrar'}
          {!submitting && <ArrowRight aria-hidden="true" />}
        </button>
      </form>

      <footer className="auth-form__footer">
        <span>Não tem uma conta?</span>
        <Link to={SIGNUP_ROUTE} className="auth-form__switch">
          Criar conta <ChevronRight aria-hidden="true" />
        </Link>
      </footer>
    </div>
  );
}
