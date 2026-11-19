import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell } from '../components/AppShell';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useToast } from '../components/ToastProvider';
import { ApiError, api } from '../lib/api';
import type { AccountStatus, AdminUser, Plan, UserStats } from '../lib/types';

const PAGE_SIZE = 20;
const EMPTY_STATS: UserStats = { TOTAL: 0, PENDING: 0, ACTIVE: 0, SUSPENDED: 0 };

const STATUS_STYLES: Record<AccountStatus, string> = {
  ACTIVE: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  PENDING: 'border-amber-200 bg-amber-50 text-amber-700',
  SUSPENDED: 'border-red-200 bg-red-50 text-red-700',
};

function formatDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function UsersPage() {
  const toast = useToast();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [stats, setStats] = useState<UserStats>(EMPTY_STATS);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'' | AccountStatus>('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.listUsers({
        search: query,
        status,
        page,
        pageSize: PAGE_SIZE,
      });
      setUsers(response.items);
      setTotal(response.total);
      setStats(response.stats);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load users.');
    } finally {
      setLoading(false);
    }
  }, [page, query, status]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    api
      .listPlans()
      .then((response) => setPlans(response.items))
      .catch(() => setPlans([]));
  }, []);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const statCards = useMemo(
    () => [
      { label: 'Total users', value: stats.TOTAL },
      { label: 'Active', value: stats.ACTIVE },
      { label: 'Pending', value: stats.PENDING },
      { label: 'Suspended', value: stats.SUSPENDED },
    ],
    [stats],
  );

  async function patchUser(user: AdminUser, patch: { accountStatus?: AccountStatus; activePlanId?: number | null }) {
    setBusyId(user.id);
    try {
      const { item } = await api.updateUserStatus(user.id, patch);
      setUsers((current) => current.map((row) => (row.id === item.id ? item : row)));
      toast.success(`Updated ${user.username}.`);
      void load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not update this user.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.deleteUser(deleteTarget.id);
      setUsers((current) => current.filter((row) => row.id !== deleteTarget.id));
      toast.success('User deleted.');
      setDeleteTarget(null);
      void load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not delete this user.');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <AppShell>
      <div className="space-y-5">
        <div>
          <h1 className="text-base font-semibold text-slate-900">Users</h1>
          <p className="text-xs text-slate-500">
            Approve accounts manually, assign plans and review activation state.
          </p>
        </div>

        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {statCards.map((stat) => (
            <div key={stat.label} className="card px-4 py-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">{stat.label}</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{stat.value}</p>
            </div>
          ))}
        </section>

        <section className="card">
          <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-3 sm:flex-row sm:items-center">
            <input
              className="input sm:max-w-xs"
              placeholder="Search name, username, email or phone…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <select
              className="input sm:max-w-[180px]"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value as '' | AccountStatus);
                setPage(1);
              }}
            >
              <option value="">All statuses</option>
              <option value="PENDING">Pending</option>
              <option value="ACTIVE">Active</option>
              <option value="SUSPENDED">Suspended</option>
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
            <div className="flex flex-col items-center gap-3 py-14">
              <span className="h-6 w-6 animate-spin rounded-full border-2 border-slate-200 border-t-brand-600" />
              <p className="text-sm text-slate-500">Loading users…</p>
            </div>
          ) : users.length === 0 ? (
            <div className="px-4 py-14 text-center">
              <p className="text-sm font-medium text-slate-700">No users found</p>
              <p className="mt-1 text-sm text-slate-500">
                Accounts appear here as soon as people sign up in the Android app.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50/70 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-2.5 font-semibold">User</th>
                    <th className="px-4 py-2.5 font-semibold">Contact</th>
                    <th className="px-4 py-2.5 font-semibold">Status</th>
                    <th className="px-4 py-2.5 font-semibold">Plan</th>
                    <th className="px-4 py-2.5 font-semibold">Joined</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {users.map((user) => (
                    <tr key={user.id} className="align-top">
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-900">{user.full_name}</p>
                        <p className="text-xs text-slate-500">@{user.username}</p>
                        {user.activation_code_used ? (
                          <p className="mt-1 font-mono text-[11px] text-slate-400">
                            {user.activation_code_used}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-slate-700">{user.email}</p>
                        <p className="text-xs text-slate-500">{user.phone || '—'}</p>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-md border px-2 py-0.5 text-xs font-semibold ${STATUS_STYLES[user.account_status]}`}
                        >
                          {user.account_status}
                        </span>
                        <select
                          className="input mt-2 !py-1 text-xs"
                          value={user.account_status}
                          disabled={busyId === user.id}
                          onChange={(event) =>
                            void patchUser(user, {
                              accountStatus: event.target.value as AccountStatus,
                            })
                          }
                          aria-label={`Change status for ${user.username}`}
                        >
                          <option value="PENDING">PENDING</option>
                          <option value="ACTIVE">ACTIVE</option>
                          <option value="SUSPENDED">SUSPENDED</option>
                        </select>
                      </td>
                      <td className="px-4 py-3">
                        <select
                          className="input !py-1 text-xs"
                          value={user.active_plan_id ?? ''}
                          disabled={busyId === user.id}
                          onChange={(event) =>
                            void patchUser(user, {
                              activePlanId: event.target.value ? Number(event.target.value) : null,
                            })
                          }
                          aria-label={`Assign plan to ${user.username}`}
                        >
                          <option value="">No plan</option>
                          {plans.map((plan) => (
                            <option key={plan.id} value={plan.id}>
                              {plan.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">
                        <p>{formatDate(user.created_at)}</p>
                        <p className="mt-1">Last active: {formatDate(user.last_active_at)}</p>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          className="btn-ghost !px-2 text-red-600 hover:bg-red-50"
                          onClick={() => setDeleteTarget(user)}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-xs text-slate-500">
            <span>
              Page {page} of {totalPages} · {total} user{total === 1 ? '' : 's'}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-secondary !py-1"
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={page <= 1 || loading}
              >
                Previous
              </button>
              <button
                type="button"
                className="btn-secondary !py-1"
                onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                disabled={page >= totalPages || loading}
              >
                Next
              </button>
            </div>
          </div>
        </section>
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete user"
        message={
          deleteTarget
            ? `${deleteTarget.full_name} (@${deleteTarget.username}) and their activity history will be permanently deleted.`
            : ''
        }
        busy={deleting}
        onConfirm={() => void handleDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </AppShell>
  );
}
