import { useEffect, useState, type FormEvent } from 'react';
import { Modal } from './Modal';
import { TypeBadge } from './Badge';
import { Switch } from './Switch';
import { useToast } from './ToastProvider';
import { ApiError, api } from '../lib/api';
import type { KnowledgeEntry } from '../lib/types';

interface EditModalProps {
  entryId: number | null;
  onClose: () => void;
  onSaved: (item: KnowledgeEntry) => void;
}

export function EditModal({ entryId, onClose, onSaved }: EditModalProps) {
  const toast = useToast();
  const [entry, setEntry] = useState<KnowledgeEntry | null>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (entryId === null) {
      setEntry(null);
      return undefined;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setEntry(null);

    api
      .getKnowledge(entryId)
      .then((response) => {
        if (cancelled) return;
        setEntry(response.item);
        setTitle(response.item.title);
        setContent(response.item.content);
        setIsActive(response.item.is_active);
      })
      .catch((err) => {
        if (cancelled) return;
        const message = err instanceof ApiError ? err.message : 'Could not load this entry.';
        setError(message);
        toast.error(message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [entryId, toast]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (entryId === null) return;
    setError(null);
    setSaving(true);
    try {
      const { item } = await api.updateKnowledge(entryId, { title, content, isActive });
      toast.success('Knowledge updated.');
      onSaved(item);
      onClose();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Could not save changes.';
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={entryId !== null}
      title="Edit knowledge"
      description={entry ? `${entry.source_type} entry · id ${entry.id}` : undefined}
      onClose={saving ? () => undefined : onClose}
      closeOnBackdrop={!saving}
      size="xl"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" form="edit-knowledge-form" className="btn-primary" disabled={saving || loading}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </>
      }
    >
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-slate-200 border-t-brand-600" />
        </div>
      ) : error && !entry ? (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : entry ? (
        <form id="edit-knowledge-form" onSubmit={handleSubmit} className="space-y-4">
          <div className="flex items-center gap-2">
            <TypeBadge type={entry.source_type} />
            {entry.file_name ? (
              <span className="truncate text-xs text-slate-500">{entry.file_name}</span>
            ) : null}
          </div>

          <div>
            <label className="label" htmlFor="edit-title">
              Title
            </label>
            <input
              id="edit-title"
              className="input"
              maxLength={255}
              required
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              disabled={saving}
            />
          </div>

          <div>
            <label className="label" htmlFor="edit-content">
              Extracted content
            </label>
            <textarea
              id="edit-content"
              className="input min-h-[300px] resize-y font-mono text-[13px] leading-6"
              required
              value={content}
              onChange={(event) => setContent(event.target.value)}
              disabled={saving}
            />
            <p className="mt-1 text-xs text-slate-400">
              Keep the <code>===== PAGE n =====</code> separators to preserve page breaks in preview.
            </p>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
            <div>
              <p className="text-sm font-medium text-slate-700">Active</p>
              <p className="text-xs text-slate-500">Inactive entries are ignored by the AI.</p>
            </div>
            <Switch checked={isActive} onChange={setIsActive} disabled={saving} label="Active knowledge" />
          </div>

          {error ? (
            <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          ) : null}
        </form>
      ) : null}
    </Modal>
  );
}
