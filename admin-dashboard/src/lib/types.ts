export interface KnowledgeSummary {
  id: number;
  title: string;
  source_type: 'TEXT' | 'PDF';
  file_name: string | null;
  page_count: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeEntry extends KnowledgeSummary {
  content: string;
}

export interface LoginResponse {
  token: string;
  admin: { email: string };
}

export interface UploadResult {
  item: KnowledgeEntry;
  pageCount: number;
}
