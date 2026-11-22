import { AppShell } from '../components/AppShell';
import { KnowledgeManager } from '../components/KnowledgeManager';

export default function DashboardPage() {
  return (
    <AppShell>
      <KnowledgeManager
        category="GENERAL"
        heading="Global knowledge manager"
        subheading="Shared notes injected into neither mode by default — use Binary or Forex strategies for scan rules."
        emptyHint="Add a general note or upload a PDF. Mode-specific rules belong in Strategies."
        footerNote="Binary and forex scans read their own strategy libraries from the Strategies page."
      />
    </AppShell>
  );
}
