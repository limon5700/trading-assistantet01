import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../components/AuthProvider';
import { ApiError } from '../lib/api';

export default function LoginPage() {
  const { status, login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    document.title = 'Sign in — AI Trading Admin';
  }, []);

  if (status === 'authenticated') {
    return <Navigate to="/" replace />;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to sign in. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-600 text-lg font-bold text-white shadow-card">
            AI
          </span>
          <h1 className="mt-4 text-xl font-semibold text-slate-900">AI Trading Assistant</h1>
          <p className="mt-1 text-sm text-slate-500">
            Sign in to manage the global trading knowledge base.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="card p-6" noValidate>
          <div className="space-y-4">
            <div>
              <label className="label" htmlFor="email">
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="username"
                required
                className="input"
                placeholder="admin@example.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={submitting}
              />
            </div>

            <div>
              <label className="label" htmlFor="password">
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                className="input"
                placeholder="••••••••"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={submitting}
              />
            </div>

            {error ? (
              <p
                role="alert"
                className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
              >
                {error}
              </p>
            ) : null}

            <button
              type="submit"
              className="btn-primary w-full"
              disabled={submitting || !email.trim() || !password}
            >
              {submitting ? (
                <>
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                  Signing in…
                </>
              ) : (
                'Sign in'
              )}
            </button>
          </div>
        </form>

        <p className="mt-6 text-center text-xs text-slate-400">
          Credentials are configured on the backend via <code>ADMIN_EMAIL</code> and{' '}
          <code>ADMIN_PASSWORD</code>.
        </p>
      </div>
    </div>
  );
}
