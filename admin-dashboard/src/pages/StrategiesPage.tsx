import { useState } from 'react';
import { AppShell } from '../components/AppShell';
import { KnowledgeManager } from '../components/KnowledgeManager';

type Tab = 'BINARY' | 'FOREX';

const TABS: Array<{ id: Tab; label: string; hint: string }> = [
  { id: 'BINARY', label: 'Binary Strategies', hint: 'Injected into every BINARY scan' },
  { id: 'FOREX', label: 'Forex Strategies', hint: 'Injected into every FOREX scan' },
];

export default function StrategiesPage() {
  const [tab, setTab] = useState<Tab>('BINARY');

  return (
    <AppShell>
      <div className="space-y-5">
        <div>
          <h1 className="text-base font-semibold text-slate-900">Strategy manager</h1>
          <p className="text-xs text-slate-500">
            Binary and forex libraries are kept separate. Only active rules of the selected mode are
            sent to Gemini.
          </p>
        </div>

        <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                tab === item.id
                  ? 'bg-brand-600 text-white shadow-sm'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {tab === 'BINARY' ? (
          <KnowledgeManager
            key="BINARY"
            category="BINARY"
            heading="Binary strategy library"
            subheading="Short-expiry price action, candlestick psychology, RSI/Bollinger and 1-minute momentum rules."
            emptyHint="Add a binary rule set or upload a PDF — the built-in pro strategies were seeded on first start."
            footerNote="Only active BINARY entries are sent with a BINARY chart scan."
          />
        ) : (
          <KnowledgeManager
            key="FOREX"
            category="FOREX"
            heading="Forex strategy library"
            subheading="Smart money concepts, market structure, Fibonacci confluence and risk-management rules."
            emptyHint="Add a forex rule set or upload a PDF — the built-in pro strategies were seeded on first start."
            footerNote="Only active FOREX entries are sent with a FOREX chart scan."
          />
        )}
      </div>
    </AppShell>
  );
}
