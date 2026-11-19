import { TypeBadge } from './Badge';
import { Switch } from './Switch';
import type { KnowledgeSummary } from '../lib/types';

interface KnowledgeTableProps {
  items: KnowledgeSummary[];
  togglingId: number | null;
  onToggle: (item: KnowledgeSummary, next: boolean) => void;
  onPreview: (item: KnowledgeSummary) => void;
  onEdit: (item: KnowledgeSummary) => void;
  onDelete: (item: KnowledgeSummary) => void;
}

function formatDate(value: string): string {
  const parsed = new Date(value.replace(' ', 'T') + 'Z');
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function KnowledgeTable({
  items,
  togglingId,
  onToggle,
  onPreview,
  onEdit,
  onDelete,
}: KnowledgeTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
            <th className="px-4 py-3 font-semibold">Title</th>
            <th className="px-4 py-3 font-semibold">Type</th>
            <th className="px-4 py-3 font-semibold">Pages</th>
            <th className="px-4 py-3 font-semibold">Created</th>
            <th className="px-4 py-3 font-semibold">Active</th>
            <th className="px-4 py-3 text-right font-semibold">Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/70">
              <td className="max-w-[320px] px-4 py-3">
                <button
                  type="button"
                  onClick={() => onPreview(item)}
                  className="block max-w-full truncate text-left font-medium text-slate-900 hover:text-brand-600"
                  title={item.title}
                >
                  {item.title}
                </button>
                {item.file_name ? (
                  <p className="mt-0.5 truncate text-xs text-slate-400">{item.file_name}</p>
                ) : null}
              </td>
              <td className="px-4 py-3">
                <TypeBadge type={item.source_type} />
              </td>
              <td className="px-4 py-3 tabular-nums text-slate-600">
                {item.page_count > 0 ? item.page_count : '—'}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-slate-500">{formatDate(item.created_at)}</td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <Switch
                    checked={item.is_active}
                    onChange={(next) => onToggle(item, next)}
                    disabled={togglingId === item.id}
                    label={`Toggle ${item.title}`}
                  />
                  <span className={`text-xs ${item.is_active ? 'text-emerald-700' : 'text-slate-400'}`}>
                    {item.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center justify-end gap-1">
                  <button type="button" className="btn-ghost !px-2.5 !py-1.5 text-xs" onClick={() => onPreview(item)}>
                    Preview
                  </button>
                  <button type="button" className="btn-ghost !px-2.5 !py-1.5 text-xs" onClick={() => onEdit(item)}>
                    Edit
                  </button>
                  <button
                    type="button"
                    className="btn !px-2.5 !py-1.5 text-xs text-red-600 hover:bg-red-50"
                    onClick={() => onDelete(item)}
                  >
                    Delete
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
