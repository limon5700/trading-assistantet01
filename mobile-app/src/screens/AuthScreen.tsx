import { useState, type FormEvent, type InputHTMLAttributes } from 'react';
import { ApiError } from '../lib/api';
import { useSession } from '../lib/session';

type Tab = 'login' | 'signup';

const EMPTY_SIGNUP = {
  full_name: '',
  email: '',
  username: '',
  phone: '',
  password: '',
  confirm_password: '',
};

export function AuthScreen() {
  const { login, signup } = useSession();
  const [tab, setTab] = useState<Tab>('login');
  const [loginForm, setLoginForm] = useState({ identifier: '', password: '' });
  const [signupForm, setSignupForm] = useState(EMPTY_SIGNUP);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function switchTab(next: Tab) {
    setTab(next);
    setError(null);
  }

  function validateSignup(): string | null {
    const { full_name, email, username, phone, password, confirm_password } = signupForm;
    if (full_name.trim().length < 2) return 'Enter your full name.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) return 'Enter a valid email address.';
    if (!/^[a-zA-Z0-9_.]{3,30}$/.test(username.trim())) {
      return 'Username must be 3-30 characters (letters, numbers, dot or underscore).';
    }
    if (phone.trim() && !/^[+0-9][0-9 ()-]{5,31}$/.test(phone.trim())) {
      return 'Enter a valid phone number.';
    }
    if (password.length < 8) return 'Password must be at least 8 characters.';
    if (password !== confirm_password) return 'Password and confirm password do not match.';
    return null;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError(null);

    if (tab === 'login') {
      if (!loginForm.identifier.trim() || !loginForm.password) {
        setError('Enter your email or username and password.');
        return;
      }
      setBusy(true);
      try {
        await login(loginForm.identifier, loginForm.password);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Could not sign in. Please try again.');
      } finally {
        setBusy(false);
      }
      return;
    }

    const validation = validateSignup();
    if (validation) {
      setError(validation);
      return;
    }

    setBusy(true);
    try {
      await signup({
        full_name: signupForm.full_name.trim(),
        email: signupForm.email.trim().toLowerCase(),
        username: signupForm.username.trim().toLowerCase(),
        phone: signupForm.phone.trim(),
        password: signupForm.password,
        confirm_password: signupForm.confirm_password,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create your account.');
    } finally {
      setBusy(false);
    }
  }

  const field = (id: string, label: string, props: InputHTMLAttributes<HTMLInputElement>) => (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <input id={id} className="input" disabled={busy} {...props} />
    </div>
  );

  return (
    <div className="auth-screen">
      <div className="auth-brand">
        <span className="auth-logo">AI</span>
        <h1>AI Trading Assistant</h1>
        <p>Signals over any trading app, on your phone.</p>
      </div>

      <div className="auth-card">
        <div className="segmented" role="tablist" aria-label="Authentication">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'login'}
            className={`segmented-btn${tab === 'login' ? ' active' : ''}`}
            onClick={() => switchTab('login')}
          >
            Login
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'signup'}
            className={`segmented-btn${tab === 'signup' ? ' active' : ''}`}
            onClick={() => switchTab('signup')}
          >
            Sign Up
          </button>
        </div>

        <form onSubmit={handleSubmit} noValidate>
          {tab === 'login' ? (
            <div className="form-stack">
              {field('login-identifier', 'Email or Username', {
                value: loginForm.identifier,
                onChange: (event) => setLoginForm({ ...loginForm, identifier: event.target.value }),
                autoComplete: 'username',
                autoCapitalize: 'none',
                autoCorrect: 'off',
                placeholder: 'you@example.com',
                required: true,
              })}
              {field('login-password', 'Password', {
                type: 'password',
                value: loginForm.password,
                onChange: (event) => setLoginForm({ ...loginForm, password: event.target.value }),
                autoComplete: 'current-password',
                placeholder: 'Your password',
                required: true,
              })}
            </div>
          ) : (
            <div className="form-stack">
              {field('signup-name', 'Full Name', {
                value: signupForm.full_name,
                onChange: (event) => setSignupForm({ ...signupForm, full_name: event.target.value }),
                autoComplete: 'name',
                placeholder: 'Your full name',
                required: true,
              })}
              {field('signup-email', 'Email', {
                type: 'email',
                value: signupForm.email,
                onChange: (event) => setSignupForm({ ...signupForm, email: event.target.value }),
                autoComplete: 'email',
                autoCapitalize: 'none',
                autoCorrect: 'off',
                placeholder: 'you@example.com',
                required: true,
              })}
              {field('signup-username', 'Username', {
                value: signupForm.username,
                onChange: (event) => setSignupForm({ ...signupForm, username: event.target.value }),
                autoComplete: 'username',
                autoCapitalize: 'none',
                autoCorrect: 'off',
                placeholder: 'trader123',
                required: true,
              })}
              {field('signup-phone', 'Phone Number', {
                type: 'tel',
                value: signupForm.phone,
                onChange: (event) => setSignupForm({ ...signupForm, phone: event.target.value }),
                autoComplete: 'tel',
                placeholder: '+8801XXXXXXXXX',
              })}
              {field('signup-password', 'Password', {
                type: 'password',
                value: signupForm.password,
                onChange: (event) => setSignupForm({ ...signupForm, password: event.target.value }),
                autoComplete: 'new-password',
                placeholder: 'At least 8 characters',
                required: true,
              })}
              {field('signup-confirm', 'Confirm Password', {
                type: 'password',
                value: signupForm.confirm_password,
                onChange: (event) =>
                  setSignupForm({ ...signupForm, confirm_password: event.target.value }),
                autoComplete: 'new-password',
                placeholder: 'Repeat your password',
                required: true,
              })}
            </div>
          )}

          {error ? (
            <div className="alert error" role="alert">
              {error}
            </div>
          ) : null}

          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
            {busy ? (
              <>
                <span className="spinner" aria-hidden="true" />
                {tab === 'login' ? 'Signing in…' : 'Creating account…'}
              </>
            ) : tab === 'login' ? (
              'Login'
            ) : (
              'Create Account'
            )}
          </button>
        </form>

      </div>

      <p className="footer-note">
        Signals are technical analysis only and are not financial advice. Trade at your own risk.
      </p>
    </div>
  );
}
