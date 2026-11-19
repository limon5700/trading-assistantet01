import { useEffect, useRef, useState, type DragEvent } from 'react';
import { Modal } from './Modal';
import { Switch } from './Switch';
import { useToast } from './ToastProvider';
import { ApiError, api } from '../lib/api';
import type { UploadResult } from '../lib/types';

interface PdfUploadModalProps {
  open: boolean;
  onClose: () => void;
  onUploaded: (result: UploadResult) => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function PdfUploadModal({ open, onClose, onUploaded }: PdfUploadModalProps) {
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);

  useEffect(() => {
    if (!open) return;
    setFile(null);
    setTitle('');
    setIsActive(true);
    setDragging(false);
    setProgress(0);
    setUploading(false);
    setError(null);
    setResult(null);
  }, [open]);

  function acceptFile(candidate: File | undefined | null) {
    if (!candidate) return;
    const isPdf =
      candidate.type === 'application/pdf' || candidate.name.toLowerCase().endsWith('.pdf');
    if (!isPdf) {
      setError('Only PDF files are supported.');
      return;
    }
    if (candidate.size === 0) {
      setError('This file is empty.');
      return;
    }
    setError(null);
    setResult(null);
    setFile(candidate);
    if (!title.trim()) setTitle(candidate.name.replace(/\.pdf$/i, ''));
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (uploading) return;
    acceptFile(event.dataTransfer.files?.[0]);
  }

  async function handleUpload() {
    if (!file) return;
    setError(null);
    setUploading(true);
    setProgress(0);
    try {
      const uploaded = await api.uploadPdf({
        file,
        title,
        isActive,
        onProgress: setProgress,
      });
      setResult(uploaded);
      toast.success(`PDF uploaded — ${uploaded.pageCount} page(s) extracted.`);
      onUploaded(uploaded);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Upload failed. Please try again.';
      setError(message);
      toast.error(message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <Modal
      open={open}
      title={result ? 'PDF imported' : 'Upload multi-page PDF'}
      description={
        result
          ? 'The extracted text is now part of the global knowledge base.'
          : 'Every page is parsed and stored with page separators.'
      }
      onClose={uploading ? () => undefined : onClose}
      closeOnBackdrop={!uploading}
      size="lg"
      footer={
        result ? (
          <button type="button" className="btn-primary" onClick={onClose}>
            Done
          </button>
        ) : (
          <>
            <button type="button" className="btn-secondary" onClick={onClose} disabled={uploading}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={handleUpload}
              disabled={!file || uploading}
            >
              {uploading ? 'Uploading…' : 'Upload & parse'}
            </button>
          </>
        )
      }
    >
      {result ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-sm font-medium text-emerald-900">{result.item.title}</p>
          <dl className="mt-2 grid grid-cols-2 gap-2 text-sm text-emerald-800">
            <div>
              <dt className="text-xs uppercase tracking-wide text-emerald-600">Pages extracted</dt>
              <dd className="font-semibold">{result.pageCount}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-emerald-600">File</dt>
              <dd className="truncate font-medium">{result.item.file_name ?? '—'}</dd>
            </div>
          </dl>
        </div>
      ) : (
        <div className="space-y-4">
          <div
            onDragOver={(event) => {
              event.preventDefault();
              if (!uploading) setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => !uploading && inputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') inputRef.current?.click();
            }}
            className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 text-center transition
              ${
                dragging
                  ? 'border-brand-500 bg-brand-50'
                  : 'border-slate-300 bg-slate-50 hover:border-brand-500 hover:bg-brand-50/40'
              } ${uploading ? 'pointer-events-none opacity-60' : ''}`}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.6}
              className="h-9 w-9 text-slate-400"
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
            </svg>
            {file ? (
              <>
                <p className="mt-3 text-sm font-medium text-slate-900">{file.name}</p>
                <p className="mt-0.5 text-xs text-slate-500">{formatSize(file.size)} · click to replace</p>
              </>
            ) : (
              <>
                <p className="mt-3 text-sm font-medium text-slate-900">
                  Drop a PDF here, or click to browse
                </p>
                <p className="mt-0.5 text-xs text-slate-500">Multi-page PDFs are fully extracted</p>
              </>
            )}
          </div>
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={(event) => {
              acceptFile(event.target.files?.[0]);
              event.target.value = '';
            }}
          />

          {uploading ? (
            <div>
              <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
                <span>Uploading &amp; parsing pages…</span>
                <span className="font-medium text-slate-700">{progress}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
                <div
                  className="h-full rounded-full bg-brand-600 transition-[width] duration-200"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          ) : null}

          <div>
            <label className="label" htmlFor="pdf-title">
              Title <span className="font-normal text-slate-400">(optional)</span>
            </label>
            <input
              id="pdf-title"
              className="input"
              maxLength={255}
              placeholder="Defaults to the file name"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              disabled={uploading}
            />
          </div>

          <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
            <div>
              <p className="text-sm font-medium text-slate-700">Active</p>
              <p className="text-xs text-slate-500">Use this document in AI analysis immediately.</p>
            </div>
            <Switch
              checked={isActive}
              onChange={setIsActive}
              disabled={uploading}
              label="Active knowledge"
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
        </div>
      )}
    </Modal>
  );
}
