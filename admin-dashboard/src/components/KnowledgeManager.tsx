import { useCallback, useEffect, useMemo, useState } from 'react';
import { KnowledgeTable } from './KnowledgeTable';
import { TextKnowledgeModal } from './TextKnowledgeModal';
import { PdfUploadModal } from './PdfUploadModal';
import { PreviewModal } from './PreviewModal';
import { EditModal } from './EditModal';
import { ConfirmDialog } from './ConfirmDialog';
import { useToast } from './ToastProvider';
import { ApiError, api } from '../lib/api';
import type { KnowledgeCategory, KnowledgeEntry, KnowledgeSummary } from '../lib/types';

interface KnowledgeManagerProps {
  category: KnowledgeCategory;
  heading: string;
  subheading: string;
  emptyHint: string;
  footerNote?: string;
}

/**
 * Full strategy manager for one category: search, stats, text rules, PDFs,
 * preview (text + original PDF), edit, activate/deactivate and delete.
 */
export function KnowledgeManager({
  category,
  heading,
  subheading,
  emptyHint,
  footerNote,
}: KnowledgeManagerProps) {
  const toast = useToast();

  const [items, setItems] = useState<KnowledgeSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  const [textModalOpen, setTextModalOpen] = useState(false);
  const [pdfModalOpen, setPdfModalOpen] = useState(false);
  const [previewId, setPreviewId] = useState<number | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<KnowledgeSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [togglingId, setTogglingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await api.listKnowledge(category);
      setItems(response.items);
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'Could not load the strategy library.');
    } finally {
      setLoading(false);
    }
  }, [category]);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = useMemo(() => {
    const active = items.filter((item) => item.is_active).length;
    const pdfs = items.filter((item) => item.source_type === 'PDF').length;
    const pages = items.reduce((total, item) => total + (item.page_count || 0), 0);
    return { total: items.length, active, pdfs, pages };
  }, [items]);

  const visibleItems = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) return items;
    return items.filter(
      (item) =>
        item.title.toLowerCase().includes(query) ||
        (item.file_name ?? '').toLowerCase().includes(query) ||
        item.source_type.toLowerCase().includes(query),
    );
  }, [items, filter]);

  function upsert(summary: KnowledgeSummary) {
    setItems((current) => {
      const without = current.filter((item) => item.id !== summary.id);
      return [summary, ...without].sort((a, b) => b.id - a.id);
    });
  }

  function handleSaved(entry: KnowledgeEntry) {
    const { content: _content, ...summary } = entry;
    void _content;
    upsert(summary);
  }

  async function handleToggle(item: KnowledgeSummary, next: boolean) {
    setTogglingId(item.id);
    setItems((current) =>
      current.map((row) => (row.id === item.id ? { ...row, is_active: next } : row)),
    );
    try {
      const { item: updated } = await api.updateKnowledge(item.id, { isActive: next });
      handleSaved(updated);
      toast.success(next ? 'Strategy activated.' : 'Strategy deactivated.');
    } catch (err) {
      setItems((current) =>
        current.map((row) => (row.id === item.id ? { ...row, is_active: item.is_active } : row)),
      );
      toast.error(err instanceof ApiError ? err.message : 'Could not update this entry.');
    } finally {
      setTogglingId(null);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.deleteKnowledge(deleteTarget.id);
      setItems((current) => current.filter((row) => row.id !== deleteTarget.id));
      toast.success('Entry deleted.');
      setDeleteTarget(null);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not delete this entry.');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-base font-semibold text-slate-900">{heading}</h1>
        <p className="text-xs text-slate-500">{subheading}</p>
      </div>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'Entries', value: stats.total },
          { label: 'Active', value: stats.active },
          { label: 'PDF sources', value: stats.pdfs },
          { label: 'Pages indexed', value: stats.pages },
        ].map((stat) => (
          <div key={stat.label} className="card px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-slate-500">{stat.label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{stat.value}</p>
          </div>
        ))}
      </section>

      <section className="card">
        <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-1 items-center gap-2">
            <div className="relative w-full max-w-xs">
              <svg
                viewBox="0 0 20 20"
                fill="currentColor"
                className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                aria-hidden="true"
              >
                <path
                  fillRule="evenodd"
                  d="M9 3.5a5.5 5.5 0 1 0 3.4 9.83l3.13 3.14a.75.75 0 1 0 1.06-1.06l-3.13-3.14A5.5 5.5 0 0 0 9 3.5ZM5 9a4 4 0 1 1 8 0 4 4 0 0 1-8 0Z"
                  clipRule="evenodd"
                />
              </svg>
              <input
                className="input pl-8"
                placeholder="Search title or file…"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
              />
            </div>
            <button
              type="button"
              className="btn-ghost hidden sm:inline-flex"
              onClick={() => void load()}
              disabled={loading}
            >
              Refresh
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn-secondary" onClick={() => setPdfModalOpen(true)}>
              <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden="true">
                <path d="M9.25 3.5a.75.75 0 0 1 1.5 0v5h5a.75.75 0 0 1 0 1.5h-5v5a.75.75 0 0 1-1.5 0v-5h-5a.75.75 0 0 1 0-1.5h5v-5Z" />
              </svg>
              Upload PDF
            </button>
            <button type="button" className="btn-primary" onClick={() => setTextModalOpen(true)}>
              <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden="true">
                <path d="M9.25 3.5a.75.75 0 0 1 1.5 0v5h5a.75.75 0 0 1 0 1.5h-5v5a.75.75 0 0 1-1.5 0v-5h-5a.75.75 0 0 1 0-1.5h5v-5Z" />
              </svg>
              Add text strategy
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16">
            <span className="h-6 w-6 animate-spin rounded-full border-2 border-slate-200 border-t-brand-600" />
            <p className="text-sm text-slate-500">Loading strategy library…</p>
          </div>
        ) : loadError ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <p className="text-sm text-red-600">{loadError}</p>
            <button type="button" className="btn-secondary" onClick={() => void load()}>
              Try again
            </button>
          </div>
        ) : visibleItems.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <p className="text-sm font-medium text-slate-700">
              {items.length === 0 ? 'No entries yet' : 'No entries match your search'}
            </p>
            <p className="max-w-sm text-sm text-slate-500">
              {items.length === 0 ? emptyHint : 'Try a different title, file name or type.'}
            </p>
          </div>
        ) : (
          <KnowledgeTable
            items={visibleItems}
            togglingId={togglingId}
            onToggle={(item, next) => void handleToggle(item, next)}
            onPreview={(item) => setPreviewId(item.id)}
            onEdit={(item) => setEditId(item.id)}
            onDelete={(item) => setDeleteTarget(item)}
          />
        )}
      </section>

      {footerNote ? <p className="text-center text-xs text-slate-400">{footerNote}</p> : null}

      <TextKnowledgeModal
        open={textModalOpen}
        category={category}
        onClose={() => setTextModalOpen(false)}
        onSaved={handleSaved}
      />
      <PdfUploadModal
        open={pdfModalOpen}
        category={category}
        onClose={() => setPdfModalOpen(false)}
        onUploaded={(result) => handleSaved(result.item)}
      />
      <PreviewModal entryId={previewId} onClose={() => setPreviewId(null)} />
      <EditModal entryId={editId} onClose={() => setEditId(null)} onSaved={handleSaved} />
      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete strategy entry"
        message={
          deleteTarget
            ? `“${deleteTarget.title}” will be permanently removed from the ${category} strategy library. This cannot be undone.`
            : ''
        }
        busy={deleting}
        onConfirm={() => void handleDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
