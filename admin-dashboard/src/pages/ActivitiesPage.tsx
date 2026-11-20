import { useCallback, useEffect, useState } from 'react';
import { AppShell } from '../components/AppShell';
import { ApiError, api } from '../lib/api';
import type { Activity, ActivityAction } from '../lib/types';

const PAGE_SIZE = 25;

const ACTION_STYLES: Record<ActivityAction, string> = {
  SIGNUP: 'border-blue-200 bg-blue-50 text-blue-700',
  LOGIN: 'border-slate-200 bg-slate-50 text-slate-600',
  ACTIVATED: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  SIGNAL_SCAN: 'border-violet-200 bg-violet-50 text-violet-700',
  SETTINGS_UPDATED: 'border-amber-200 bg-amber-50 text-amber-700',
  PAYMENT_VERIFIED: 'border-teal-200 bg-teal-50 text-teal-700',
};

const ACTIONS: ActivityAction[] = [
  'SIGNUP',
  'LOGIN',
  'ACTIVATED',
  'SIGNAL_SCAN',
  'SETTINGS_UPDATED',
  'PAYMENT_VERIFIED',
];

function formatDateTime(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function describeDetails(details: string | null): string {
  if (!details) return '';
  try {
    const parsed = JSON.parse(details) as Record<string, unknown>;
    return Object.entries(parsed)
      .map(([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
      .join(' · ');
  } catch {
    return details;
  }
}

export default function ActivitiesPage() {
  const [items, setItems] = useState<Activity[]>([]);
  const [action, setAction] = useState<ActivityAction | ''>('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.listActivities({ action, page, pageSize: PAGE_SIZE });
      setItems(response.items);
      setTotal(response.total);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the activity feed.');
    } finally {
      setLoading(false);
    }
  }, [action, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <AppShell>
      <div className="space-y-5">
        <div>
          <h1 className="text-base font-semibold text-slate-900">User activity</h1>
          <p className="text-xs text-slate-500">
            Signups, logins, activations and chart scans, newest first.
          </p>
        </div>

        <section className="card">
          <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-4 py-3">
            <select
              className="input max-w-[200px]"
              value={action}
              onChange={(event) => {
                setAction(event.target.value as ActivityAction | '');
                setPage(1);
              }}
              aria-label="Filter by action"
            >
              <option value="">All actions</option>
              {ACTIONS.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
            <button type="button" className="btn-ghost sm:ml-auto" onClick={() => void load()}>
              Refresh
            </button>
          </div>

          {error ? (
            <div className="px-4 py-10 text-center">
              <p className="text-sm text-red-600">{error}</p>
              <button type="button" className="btn-secondary mt-3" onClick={() => void load()}>
                Try again
              </button>
            </div>
          ) : loading ? (
            <div className="flex items-center justify-center py-14">
              <span className="h-6 w-6 animate-spin rounded-full border-2 border-slate-200 border-t-brand-600" />
            </div>
          ) : items.length === 0 ? (
            <div className="px-4 py-14 text-center">
              <p className="text-sm font-medium text-slate-700">No activity yet</p>
              <p className="mt-1 text-sm text-slate-500">
                Events show up here as users sign up, sign in and scan charts.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {items.map((activity) => (
                <li key={activity.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                  <span
                    className={`inline-flex shrink-0 rounded-md border px-2 py-0.5 text-xs font-semibold ${ACTION_STYLES[activity.action]}`}
                  >
                    {activity.action}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-slate-800">
                      {activity.full_name}
                      {activity.username ? (
                        <span className="text-slate-500"> @{activity.username}</span>
                      ) : null}
                    </p>
                    {activity.details ? (
                      <p className="mt-0.5 break-words text-xs text-slate-500">
                        {describeDetails(activity.details)}
                      </p>
                    ) : null}
                  </div>
                  <span className="shrink-0 text-xs text-slate-400">
                    {formatDateTime(activity.created_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-xs text-slate-500">
            <span>
              Page {page} of {totalPages} · {total} event{total === 1 ? '' : 's'}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-secondary !py-1"
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={page <= 1}
              >
                Previous
              </button>
              <button
                type="button"
                className="btn-secondary !py-1"
                onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                disabled={page >= totalPages}
              >
                Next
              </button>
            </div>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
