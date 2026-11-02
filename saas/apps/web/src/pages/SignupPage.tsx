import { ArrowRight, ChevronRight } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { PASSWORD_MIN_LENGTH, signupRequestSchema } from '@disparazap/contracts';
import { useAuth } from '../auth/AuthProvider';
import { LOGIN_PATH } from '../auth/guards';
import { BrandMark } from '../components/BrandMark';
import { PasswordField } from '../components/PasswordField';

export function SignupPage() {
  const { signUp } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    // Mesma validação da API (contrato compartilhado), para avisar antes de enviar
    const parsed = signupRequestSchema.safeParse({ name, companyName, email: email.trim(), password });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Confira os dados informados.');
      return;
    }
    if (password !== confirmation) {
      setError('As senhas não conferem.');
      return;
    }
    setSubmitting(true);
    const result = await signUp(parsed.data);
    setSubmitting(false);
    if (result.ok) navigate('/', { replace: true });
    else setError(result.message);
  }

  return (
    <div className="auth-form">
      <div className="auth-form__header">
        <span className="auth-form__icon"><BrandMark size={52} /></span>
        <h1 className="auth-form__title">Crie sua conta</h1>
        <p className="auth-form__subtitle">Cadastre sua empresa para começar a usar o DisparaZap.</p>
      </div>

      <form className="auth-form__body" onSubmit={handleSubmit}>
        <div className="field">
          <label className="field__label" htmlFor="signup-name">Seu nome</label>
          <input id="signup-name" className="field__input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required />
        </div>
        <div className="field">
          <label className="field__label" htmlFor="signup-company">Nome da empresa</label>
          <input id="signup-company" className="field__input" value={companyName} onChange={(e) => setCompanyName(e.target.value)} autoComplete="organization" required />
        </div>
        <div className="field">
          <label className="field__label" htmlFor="signup-email">E-mail</label>
          <input id="signup-email" className="field__input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
        </div>
        <PasswordField
          label="Senha"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          hint={`Mínimo de ${PASSWORD_MIN_LENGTH} caracteres.`}
        />
        <PasswordField label="Repita a senha" value={confirmation} onChange={setConfirmation} autoComplete="new-password" />

        {error && <p className="auth-alert" role="alert">{error}</p>}

        <button type="submit" className="auth-button" disabled={submitting}>
          {submitting ? 'Criando conta…' : 'Criar conta'}
          {!submitting && <ArrowRight aria-hidden="true" />}
        </button>
      </form>

      <footer className="auth-form__footer">
        <span>Já tem uma conta?</span>
        <Link to={LOGIN_PATH} className="auth-form__switch">
          Entrar <ChevronRight aria-hidden="true" />
        </Link>
      </footer>
    </div>
  );
}
