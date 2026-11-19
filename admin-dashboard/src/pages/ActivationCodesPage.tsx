import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { AppShell } from '../components/AppShell';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Modal } from '../components/Modal';
import { useToast } from '../components/ToastProvider';
import { ApiError, api } from '../lib/api';
import type { ActivationCode, AdminUser, Plan } from '../lib/types';

type StatusFilter = '' | 'unused' | 'used' | 'expired';

const PAGE_SIZE = 100;

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

function codeState(code: ActivationCode): { label: string; className: string } {
  if (code.is_used) return { label: 'Used', className: 'border-slate-200 bg-slate-50 text-slate-600' };
  if (code.expires_at) {
    const expires = new Date(`${code.expires_at.replace(' ', 'T')}Z`);
    if (!Number.isNaN(expires.getTime()) && expires.getTime() < Date.now()) {
      return { label: 'Expired', className: 'border-red-200 bg-red-50 text-red-700' };
    }
  }
  return { label: 'Unused', className: 'border-emerald-200 bg-emerald-50 text-emerald-700' };
}

export default function ActivationCodesPage() {
  const toast = useToast();
  const [codes, setCodes] = useState<ActivationCode[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [status, setStatus] = useState<StatusFilter>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  const [modalOpen, setModalOpen] = useState(false);
  const [userId, setUserId] = useState('');
  const [planId, setPlanId] = useState('');
  const [expiresInDays, setExpiresInDays] = useState('');
  const [generating, setGenerating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [lastGenerated, setLastGenerated] = useState<ActivationCode | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<ActivationCode | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.listActivationCodes({ status, page, pageSize: PAGE_SIZE });
      setCodes(response.items);
      setTotal(response.total);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load activation codes.');
    } finally {
      setLoading(false);
    }
  }, [page, status]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    api
      .listUsers({ pageSize: 100 })
      .then((response) => setUsers(response.items))
      .catch(() => setUsers([]));
    api
      .listPlans()
      .then((response) => {
        setPlans(response.items);
        const firstActive = response.items.find((plan) => plan.is_active);
        if (firstActive) setPlanId(String(firstActive.id));
      })
      .catch(() => setPlans([]));
  }, []);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const activePlans = useMemo(() => plans.filter((plan) => plan.is_active), [plans]);

  function openGenerate() {
    setUserId('');
    setExpiresInDays('');
    setFormError(null);
    setLastGenerated(null);
    if (!planId && activePlans[0]) setPlanId(String(activePlans[0].id));
    setModalOpen(true);
  }

  async function handleGenerate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (generating) return;

    if (!userId) {
      setFormError('Select the user this code belongs to.');
      return;
    }
    if (!planId) {
      setFormError('Select a plan for this code.');
      return;
    }
    const days = expiresInDays.trim() ? Number(expiresInDays) : null;
    if (days !== null && (!Number.isInteger(days) || days <= 0)) {
      setFormError('Expiry must be a positive number of days, or empty for no expiry.');
      return;
    }

    setGenerating(true);
    setFormError(null);
    try {
      const { item } = await api.generateActivationCode({
        userId: Number(userId),
        planId: Number(planId),
        expiresInDays: days,
      });
      setLastGenerated(item);
      toast.success(`Code ${item.code} generated.`);
      void load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not generate a code.');
    } finally {
      setGenerating(false);
    }
  }

  async function copyCode(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      toast.success('Code copied.');
    } catch {
      toast.error('Copy failed — select the code manually.');
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.deleteActivationCode(deleteTarget.id);
      setCodes((current) => current.filter((code) => code.id !== deleteTarget.id));
      toast.success('Activation code deleted.');
      setDeleteTarget(null);
      void load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not delete this code.');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <AppShell>
      <div className="space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-base font-semibold text-slate-900">Activation codes</h1>
            <p className="text-xs text-slate-500">
              One code per user. Codes are single-use and tied to the chosen plan.
            </p>
          </div>
          <button type="button" className="btn-primary" onClick={openGenerate}>
            Generate code
          </button>
        </div>

        <section className="card">
          <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-4 py-3">
            <select
              className="input max-w-[190px]"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value as StatusFilter);
                setPage(1);
              }}
              aria-label="Filter codes by status"
            >
              <option value="">All codes</option>
              <option value="unused">Unused</option>
              <option value="used">Used</option>
              <option value="expired">Expired</option>
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
          ) : codes.length === 0 ? (
            <div className="px-4 py-14 text-center">
              <p className="text-sm font-medium text-slate-700">No codes here</p>
              <p className="mt-1 text-sm text-slate-500">
                Generate a code for a user once their affiliate signup or payment is verified.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50/70 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-2.5 font-semibold">Code</th>
                    <th className="px-4 py-2.5 font-semibold">Assigned user</th>
                    <th className="px-4 py-2.5 font-semibold">Plan</th>
                    <th className="px-4 py-2.5 font-semibold">Status</th>
                    <th className="px-4 py-2.5 font-semibold">Created</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {codes.map((code) => {
                    const state = codeState(code);
                    return (
                      <tr key={code.id}>
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => void copyCode(code.code)}
                            className="font-mono text-sm font-semibold text-slate-900 hover:text-brand-700"
                            title="Copy code"
                          >
                            {code.code}
                          </button>
                          {code.expires_at ? (
                            <p className="text-[11px] text-slate-400">
                              Expires {formatDateTime(code.expires_at)}
                            </p>
                          ) : null}
                        </td>
                        <td className="px-4 py-3">
                          {code.assigned_user_name ? (
                            <>
                              <p className="text-slate-800">{code.assigned_user_name}</p>
                              <p className="text-xs text-slate-500">@{code.assigned_username}</p>
                            </>
                          ) : (
                            <span className="text-xs text-slate-400">Unassigned</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-700">{code.plan_name || '—'}</td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex rounded-md border px-2 py-0.5 text-xs font-semibold ${state.className}`}
                          >
                            {state.label}
                          </span>
                          {code.is_used ? (
                            <p className="mt-1 text-[11px] text-slate-400">
                              by {code.used_by_user_name || 'deleted user'} · {formatDateTime(code.used_at)}
                            </p>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-500">
                          {formatDateTime(code.created_at)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            className="btn-ghost !px-2 text-red-600 hover:bg-red-50"
                            onClick={() => setDeleteTarget(code)}
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-xs text-slate-500">
            <span>
              Page {page} of {totalPages} · {total} code{total === 1 ? '' : 's'}
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

      <Modal
        open={modalOpen}
        title="Generate activation code"
        description="The code only activates the user it is assigned to."
        onClose={() => (generating ? undefined : setModalOpen(false))}
        closeOnBackdrop={!generating}
        size="md"
        footer={
          <>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setModalOpen(false)}
              disabled={generating}
            >
              Close
            </button>
            <button type="submit" form="code-form" className="btn-primary" disabled={generating}>
              {generating ? 'Generating…' : 'Generate code'}
            </button>
          </>
        }
      >
        <form id="code-form" onSubmit={handleGenerate} className="space-y-4" noValidate>
          <div>
            <label className="label" htmlFor="code-user">
              User
            </label>
            <select
              id="code-user"
              className="input"
              value={userId}
              onChange={(event) => setUserId(event.target.value)}
              required
            >
              <option value="">Select a user…</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.full_name} (@{user.username}) · {user.account_status}
                </option>
              ))}
            </select>
            {users.length === 0 ? (
              <p className="mt-1 text-xs text-slate-500">
                No users yet. They appear here after signing up in the app.
              </p>
            ) : null}
          </div>

          <div>
            <label className="label" htmlFor="code-plan">
              Plan
            </label>
            <select
              id="code-plan"
              className="input"
              value={planId}
              onChange={(event) => setPlanId(event.target.value)}
              required
            >
              <option value="">Select a plan…</option>
              {(activePlans.length ? activePlans : plans).map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {plan.name} · {plan.plan_type} · ${plan.price.toFixed(2)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label" htmlFor="code-expiry">
              Expires in (days, optional)
            </label>
            <input
              id="code-expiry"
              className="input"
              inputMode="numeric"
              placeholder="No expiry"
              value={expiresInDays}
              onChange={(event) => setExpiresInDays(event.target.value)}
            />
          </div>

          {formError ? (
            <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {formError}
            </p>
          ) : null}

          {lastGenerated ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">
                Code for {lastGenerated.assigned_user_name}
              </p>
              <div className="mt-1 flex items-center justify-between gap-3">
                <code className="text-base font-bold text-emerald-900">{lastGenerated.code}</code>
                <button
                  type="button"
                  className="btn-secondary !py-1"
                  onClick={() => void copyCode(lastGenerated.code)}
                >
                  Copy
                </button>
              </div>
              <p className="mt-1 text-xs text-emerald-800">
                Send this to the user. It can only be used once.
              </p>
            </div>
          ) : null}
        </form>
      </Modal>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete activation code"
        message={
          deleteTarget ? `Code ${deleteTarget.code} will be permanently deleted.` : ''
        }
        busy={deleting}
        onConfirm={() => void handleDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </AppShell>
  );
}
