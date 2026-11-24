interface BadgeProps {
  type: 'TEXT' | 'PDF' | 'PDF_TEXT';
}

const styles: Record<BadgeProps['type'], string> = {
  TEXT: 'border-blue-200 bg-blue-50 text-blue-700',
  PDF: 'border-violet-200 bg-violet-50 text-violet-700',
  PDF_TEXT: 'border-emerald-200 bg-emerald-50 text-emerald-700',
};

const labels: Record<BadgeProps['type'], string> = {
  TEXT: 'TEXT',
  PDF: 'PDF',
  PDF_TEXT: 'PDF TEXT',
};

export function TypeBadge({ type }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-semibold tracking-wide ${styles[type]}`}
    >
      {type !== 'TEXT' ? (
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-3 w-3" aria-hidden="true">
          <path d="M4 2a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6.5L13.5 2H4Zm7 1.5L15.5 8H11V3.5Z" />
        </svg>
      ) : (
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-3 w-3" aria-hidden="true">
          <path d="M4 3h12v2H4V3Zm0 4h12v2H4V7Zm0 4h8v2H4v-2Zm0 4h6v2H4v-2Z" />
        </svg>
      )}
      {labels[type]}
    </span>
  );
}
