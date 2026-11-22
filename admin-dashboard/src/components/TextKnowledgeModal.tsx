import { useEffect, useState, type FormEvent } from 'react';
import { Modal } from './Modal';
import { Switch } from './Switch';
import { useToast } from './ToastProvider';
import { ApiError, api } from '../lib/api';
import type { KnowledgeCategory, KnowledgeEntry } from '../lib/types';

interface TextKnowledgeModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: (item: KnowledgeEntry) => void;
  category: KnowledgeCategory;
}

export function TextKnowledgeModal({ open, onClose, onSaved, category }: TextKnowledgeModalProps) {
  const toast = useToast();
  const [entryCategory, setEntryCategory] = useState<KnowledgeCategory>(category);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTitle('');
    setContent('');
    setIsActive(true);
    setEntryCategory(category);
    setError(null);
    setSaving(false);
  }, [open, category]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const { item } = await api.createText({ title, content, isActive, category: entryCategory });
      toast.success('Text knowledge added.');
      onSaved(item);
      onClose();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Could not save this entry.';
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      title="Add text knowledge"
      description="Rules and strategies injected into every chart analysis."
      onClose={saving ? () => undefined : onClose}
      closeOnBackdrop={!saving}
      size="lg"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" form="text-knowledge-form" className="btn-primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save knowledge'}
          </button>
        </>
      }
    >
      <form id="text-knowledge-form" onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="label" htmlFor="text-category">
            Strategy category
          </label>
          <select
            id="text-category"
            className="input"
            value={entryCategory}
            onChange={(event) => setEntryCategory(event.target.value as KnowledgeCategory)}
            disabled={saving}
          >
            <option value="BINARY">Binary strategies</option>
            <option value="FOREX">Forex strategies</option>
            <option value="GENERAL">General knowledge</option>
          </select>
        </div>

        <div>
          <label className="label" htmlFor="text-title">
            Title
          </label>
          <input
            id="text-title"
            className="input"
            maxLength={255}
            required
            placeholder="e.g. London session reversal rules"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            disabled={saving}
          />
        </div>

        <div>
          <label className="label" htmlFor="text-content">
            Strategy / rules
          </label>
          <textarea
            id="text-content"
            className="input min-h-[220px] resize-y font-mono text-[13px] leading-6"
            required
            placeholder={'- Only trade 5M candles inside the London/NY overlap\n- Enter after a confirmed engulfing close above the 20 EMA\n- Skip trades against the H1 trend'}
            value={content}
            onChange={(event) => setContent(event.target.value)}
            disabled={saving}
          />
          <p className="mt-1 text-xs text-slate-400">
            {content.trim() ? `${content.trim().split(/\s+/).length} words` : 'Be specific and concise.'}
          </p>
        </div>

        <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
          <div>
            <p className="text-sm font-medium text-slate-700">Active</p>
            <p className="text-xs text-slate-500">Inactive entries are ignored by the AI.</p>
          </div>
          <Switch
            checked={isActive}
            onChange={setIsActive}
            disabled={saving}
            label="Active knowledge"
          />
        </div>

        {error ? (
          <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
