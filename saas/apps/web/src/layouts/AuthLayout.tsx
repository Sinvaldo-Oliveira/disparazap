import { Outlet } from 'react-router';
import { AuthShowcase } from '../components/AuthShowcase';
import { BrandMark } from '../components/BrandMark';

/** Telas de entrar e criar conta: formulário à esquerda, apresentação do produto à direita */
export function AuthLayout() {
  return (
    <div className="auth">
      <div className="auth__panel">
        <div className="auth__brand">
          <BrandMark size={26} />
          <span>DisparaZap</span>
        </div>
        <main className="auth__content">
          <Outlet />
        </main>
      </div>
      <AuthShowcase />
    </div>
  );
}
