import { useEffect, useState } from 'react';
import { Modal } from './Modal';
import { TypeBadge } from './Badge';
import { useToast } from './ToastProvider';
import { ApiError, api } from '../lib/api';
import type { KnowledgeEntry } from '../lib/types';

const PAGE_MARKER = /=====\s*PAGE\s+\d+\s*=====/g;

function splitPages(content: string): string[] {
  return content
    .split(PAGE_MARKER)
    .map((page) => page.trim())
    .filter((page) => page.length > 0);
}

interface PreviewModalProps {
  entryId: number | null;
  onClose: () => void;
}

export function PreviewModal({ entryId, onClose }: PreviewModalProps) {
  const toast = useToast();
  const [entry, setEntry] = useState<KnowledgeEntry | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (entryId === null) {
      setEntry(null);
      setError(null);
      return undefined;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setEntry(null);

    api
      .getKnowledge(entryId)
      .then((response) => {
        if (!cancelled) setEntry(response.item);
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

  const pages = entry ? splitPages(entry.content) : [];

  return (
    <Modal
      open={entryId !== null}
      title={entry?.title ?? 'Loading preview…'}
      description={
        entry
          ? `${entry.source_type}${entry.page_count > 0 ? ` · ${entry.page_count} page(s)` : ' · plain text'}${
              entry.file_name ? ` · ${entry.file_name}` : ''
            }`
          : undefined
      }
      onClose={onClose}
      size="xl"
      footer={
        <button type="button" className="btn-secondary" onClick={onClose}>
          Close
        </button>
      }
    >
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-slate-200 border-t-brand-600" />
        </div>
      ) : error ? (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : entry ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <TypeBadge type={entry.source_type} />
            <span
              className={`rounded-md border px-2 py-0.5 font-medium ${
                entry.is_active
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : 'border-slate-200 bg-slate-100 text-slate-500'
              }`}
            >
              {entry.is_active ? 'Active' : 'Inactive'}
            </span>
            <span>Created {new Date(entry.created_at.replace(' ', 'T') + 'Z').toLocaleString()}</span>
          </div>

          {pages.length > 1 ? (
            <div className="space-y-4">
              {pages.map((page, index) => (
                <section key={index} className="rounded-lg border border-slate-200">
                  <header className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-1.5">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Page {index + 1} of {pages.length}
                    </h3>
                  </header>
                  <pre className="whitespace-pre-wrap break-words px-4 py-3 font-sans text-sm leading-6 text-slate-700">
                    {page}
                  </pre>
                </section>
              ))}
            </div>
          ) : (
            <pre className="whitespace-pre-wrap break-words rounded-lg border border-slate-200 bg-slate-50/60 px-4 py-3 font-sans text-sm leading-6 text-slate-700">
              {pages[0] ?? entry.content}
            </pre>
          )}
        </div>
      ) : null}
    </Modal>
  );
}
