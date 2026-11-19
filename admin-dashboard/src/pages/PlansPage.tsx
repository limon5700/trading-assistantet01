import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { AppShell } from '../components/AppShell';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Modal } from '../components/Modal';
import { useToast } from '../components/ToastProvider';
import { ApiError, api } from '../lib/api';
import type { Plan, PlanInput } from '../lib/types';

interface PlanForm {
  name: string;
  plan_type: 'FREE' | 'PAID';
  price: string;
  duration_days: string;
  description: string;
  features: string;
  is_active: boolean;
}

const EMPTY_FORM: PlanForm = {
  name: '',
  plan_type: 'PAID',
  price: '0',
  duration_days: '30',
  description: '',
  features: '',
  is_active: true,
};

function toForm(plan: Plan): PlanForm {
  return {
    name: plan.name,
    plan_type: plan.plan_type,
    price: String(plan.price),
    duration_days: String(plan.duration_days),
    description: plan.description,
    features: plan.features.join('\n'),
    is_active: plan.is_active,
  };
}

export default function PlansPage() {
  const toast = useToast();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Plan | null>(null);
  const [form, setForm] = useState<PlanForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<Plan | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.listPlans();
      setPlans(response.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load plans.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setModalOpen(true);
  }

  function openEdit(plan: Plan) {
    setEditing(plan);
    setForm(toForm(plan));
    setFormError(null);
    setModalOpen(true);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;

    const name = form.name.trim();
    const price = Number(form.price);
    const duration = Number(form.duration_days);
    const features = form.features
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    if (!name) {
      setFormError('Plan name is required.');
      return;
    }
    if (!Number.isFinite(price) || price < 0) {
      setFormError('Price must be zero or greater.');
      return;
    }
    if (!Number.isInteger(duration) || duration < 1 || duration > 36500) {
      setFormError('Duration must be a whole number of days between 1 and 36500.');
      return;
    }

    const payload: PlanInput = {
      name,
      plan_type: form.plan_type,
      price,
      duration_days: duration,
      description: form.description.trim(),
      features,
      is_active: form.is_active,
    };

    setSaving(true);
    setFormError(null);
    try {
      if (editing) {
        const { item } = await api.updatePlan(editing.id, payload);
        setPlans((current) => current.map((plan) => (plan.id === item.id ? item : plan)));
        toast.success('Plan updated.');
      } else {
        const { item } = await api.createPlan(payload);
        setPlans((current) => [...current, item].sort((a, b) => a.price - b.price));
        toast.success('Plan created.');
      }
      setModalOpen(false);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not save this plan.');
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(plan: Plan) {
    setBusyId(plan.id);
    try {
      const { item } = await api.updatePlan(plan.id, { is_active: !plan.is_active });
      setPlans((current) => current.map((row) => (row.id === item.id ? item : row)));
      toast.success(item.is_active ? 'Plan activated.' : 'Plan deactivated.');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not update this plan.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.deletePlan(deleteTarget.id);
      setPlans((current) => current.filter((plan) => plan.id !== deleteTarget.id));
      toast.success('Plan deleted.');
      setDeleteTarget(null);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not delete this plan.');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <AppShell>
      <div className="space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-base font-semibold text-slate-900">Subscription plans</h1>
            <p className="text-xs text-slate-500">
              The plans shown to users on the activation screen.
            </p>
          </div>
          <button type="button" className="btn-primary" onClick={openCreate}>
            New plan
          </button>
        </div>

        {error ? (
          <div className="card px-4 py-10 text-center">
            <p className="text-sm text-red-600">{error}</p>
            <button type="button" className="btn-secondary mt-3" onClick={() => void load()}>
              Try again
            </button>
          </div>
        ) : loading ? (
          <div className="card flex items-center justify-center py-14">
            <span className="h-6 w-6 animate-spin rounded-full border-2 border-slate-200 border-t-brand-600" />
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {plans.map((plan) => (
              <article key={plan.id} className="card flex flex-col p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <span
                      className={`inline-flex rounded-md border px-2 py-0.5 text-xs font-semibold ${
                        plan.plan_type === 'FREE'
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          : 'border-blue-200 bg-blue-50 text-blue-700'
                      }`}
                    >
                      {plan.plan_type}
                    </span>
                    <h2 className="mt-2 text-base font-semibold text-slate-900">{plan.name}</h2>
                    <p className="text-sm text-slate-500">
                      ${plan.price.toFixed(2)} · {plan.duration_days} days
                    </p>
                  </div>
                  <span
                    className={`rounded-md border px-2 py-0.5 text-xs font-semibold ${
                      plan.is_active
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                        : 'border-slate-200 bg-slate-50 text-slate-500'
                    }`}
                  >
                    {plan.is_active ? 'Active' : 'Hidden'}
                  </span>
                </div>

                {plan.description ? (
                  <p className="mt-3 text-sm leading-relaxed text-slate-600">{plan.description}</p>
                ) : null}

                {plan.features.length ? (
                  <ul className="mt-3 space-y-1.5 text-sm text-slate-600">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex gap-2">
                        <span className="text-emerald-600">✓</span>
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}

                <div className="mt-auto flex flex-wrap gap-2 pt-4">
                  <button type="button" className="btn-secondary" onClick={() => openEdit(plan)}>
                    Edit
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => void toggleActive(plan)}
                    disabled={busyId === plan.id}
                  >
                    {plan.is_active ? 'Deactivate' : 'Activate'}
                  </button>
                  <button
                    type="button"
                    className="btn-ghost text-red-600 hover:bg-red-50"
                    onClick={() => setDeleteTarget(plan)}
                  >
                    Delete
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      <Modal
        open={modalOpen}
        title={editing ? 'Edit plan' : 'New plan'}
        description="Plans control what users see on the activation screen."
        onClose={() => (saving ? undefined : setModalOpen(false))}
        closeOnBackdrop={!saving}
        size="md"
        footer={
          <>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setModalOpen(false)}
              disabled={saving}
            >
              Cancel
            </button>
            <button type="submit" form="plan-form" className="btn-primary" disabled={saving}>
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Create plan'}
            </button>
          </>
        }
      >
        <form id="plan-form" onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div>
            <label className="label" htmlFor="plan-name">
              Name
            </label>
            <input
              id="plan-name"
              className="input"
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              placeholder="Paid Pro Plan"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="plan-type">
                Type
              </label>
              <select
                id="plan-type"
                className="input"
                value={form.plan_type}
                onChange={(event) =>
                  setForm({ ...form, plan_type: event.target.value as PlanForm['plan_type'] })
                }
              >
                <option value="FREE">FREE</option>
                <option value="PAID">PAID</option>
              </select>
            </div>
            <div>
              <label className="label" htmlFor="plan-price">
                Price (USD)
              </label>
              <input
                id="plan-price"
                className="input"
                inputMode="decimal"
                value={form.price}
                onChange={(event) => setForm({ ...form, price: event.target.value })}
              />
            </div>
          </div>

          <div>
            <label className="label" htmlFor="plan-duration">
              Duration (days)
            </label>
            <input
              id="plan-duration"
              className="input"
              inputMode="numeric"
              value={form.duration_days}
              onChange={(event) => setForm({ ...form, duration_days: event.target.value })}
            />
          </div>

          <div>
            <label className="label" htmlFor="plan-description">
              Description
            </label>
            <textarea
              id="plan-description"
              className="input min-h-[72px]"
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
              placeholder="Shown on the activation screen"
            />
          </div>

          <div>
            <label className="label" htmlFor="plan-features">
              Features (one per line)
            </label>
            <textarea
              id="plan-features"
              className="input min-h-[96px]"
              value={form.features}
              onChange={(event) => setForm({ ...form, features: event.target.value })}
              placeholder={'Unlimited chart scans\nPriority support'}
            />
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(event) => setForm({ ...form, is_active: event.target.checked })}
              className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
            />
            Visible to users
          </label>

          {formError ? (
            <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {formError}
            </p>
          ) : null}
        </form>
      </Modal>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete plan"
        message={
          deleteTarget
            ? `“${deleteTarget.name}” will be removed. Plans that already have codes or users cannot be deleted — deactivate them instead.`
            : ''
        }
        busy={deleting}
        onConfirm={() => void handleDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </AppShell>
  );
}
