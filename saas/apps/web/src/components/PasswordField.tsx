import { Eye, EyeOff } from 'lucide-react';
import { useId, useState } from 'react';

interface PasswordFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: 'current-password' | 'new-password';
  hint?: string;
  invalid?: boolean;
  required?: boolean;
}

export function PasswordField({ label, value, onChange, autoComplete, hint, invalid, required = true }: PasswordFieldProps) {
  const id = useId();
  const hintId = `${id}-dica`;
  const [visible, setVisible] = useState(false);

  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>{label}</label>
      <div className="field__control">
        <input
          id={id}
          className="field__input field__input--with-action"
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={autoComplete}
          required={required}
          aria-invalid={invalid || undefined}
          aria-describedby={hint ? hintId : undefined}
        />
        <button
          type="button"
          className="field__action"
          onClick={() => setVisible((shown) => !shown)}
          aria-label={visible ? `Ocultar ${label.toLowerCase()}` : `Mostrar ${label.toLowerCase()}`}
          aria-pressed={visible}
        >
          {visible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
        </button>
      </div>
      {hint && <p id={hintId} className="field__hint">{hint}</p>}
    </div>
  );
}
