import { useEffect, type ReactNode } from 'react';

interface LegalModalProps {
  open: boolean;
  title: string;
  content: string;
  onClose: () => void;
}

/** Renders the subset of Markdown used by the CMS pages. */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    const token = match[0];
    if (token.startsWith('**')) {
      nodes.push(<strong key={`${keyPrefix}-b-${index}`}>{token.slice(2, -2)}</strong>);
    } else {
      nodes.push(<code key={`${keyPrefix}-c-${index}`}>{token.slice(1, -1)}</code>);
    }
    lastIndex = pattern.lastIndex;
    index += 1;
  }

  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

export function MarkdownContent({ content }: { content: string }) {
  const lines = String(content || '').replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let list: ReactNode[] = [];
  let ordered = false;

  const flushList = () => {
    if (!list.length) return;
    const Tag = ordered ? 'ol' : 'ul';
    blocks.push(
      <Tag key={`list-${blocks.length}`} className="legal-list">
        {list}
      </Tag>,
    );
    list = [];
  };

  lines.forEach((rawLine, index) => {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (!trimmed) {
      flushList();
      return;
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flushList();
      const level = heading[1].length;
      const Tag = level === 1 ? 'h2' : level === 2 ? 'h3' : 'h4';
      blocks.push(
        <Tag key={`h-${index}`} className={`legal-heading legal-h${level}`}>
          {renderInline(heading[2], `h-${index}`)}
        </Tag>,
      );
      return;
    }

    const bullet = /^[-*]\s+(.*)$/.exec(trimmed);
    if (bullet) {
      if (ordered) flushList();
      ordered = false;
      list.push(<li key={`li-${index}`}>{renderInline(bullet[1], `li-${index}`)}</li>);
      return;
    }

    const numbered = /^(\d+)\.\s+(.*)$/.exec(trimmed);
    if (numbered) {
      if (!ordered) flushList();
      ordered = true;
      list.push(<li key={`li-${index}`}>{renderInline(numbered[2], `li-${index}`)}</li>);
      return;
    }

    flushList();
    blocks.push(
      <p key={`p-${index}`} className="legal-paragraph">
        {renderInline(trimmed, `p-${index}`)}
      </p>,
    );
  });

  flushList();
  return <div className="legal-body">{blocks}</div>;
}

export function LegalModal({ open, title, content, onClose }: LegalModalProps) {
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="sheet-backdrop" role="dialog" aria-modal="true" aria-label={title}>
      <div className="sheet">
        <header className="sheet-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        </header>
        <div className="sheet-body">
          {content ? (
            <MarkdownContent content={content} />
          ) : (
            <p className="placeholder">This page has not been published yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}
