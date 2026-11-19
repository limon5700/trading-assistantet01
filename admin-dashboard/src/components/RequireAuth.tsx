import { Navigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from './AuthProvider';

export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();

  if (status === 'loading') {
    return (
      <div className="flex h-full min-h-screen items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-3">
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-slate-200 border-t-brand-600" />
          <p className="text-sm text-slate-500">Restoring session…</p>
        </div>
      </div>
    );
  }

  if (status === 'anonymous') {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}
