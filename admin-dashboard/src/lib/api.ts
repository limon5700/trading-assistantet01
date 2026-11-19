import type { KnowledgeEntry, KnowledgeSummary, LoginResponse, UploadResult } from './types';

const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');
const TOKEN_KEY = 'ai_trading_admin_token';

export const authEvents = new EventTarget();

let token: string | null = localStorage.getItem(TOKEN_KEY);

export function getToken(): string | null {
  return token;
}

export function setToken(next: string | null): void {
  token = next;
  if (next) localStorage.setItem(TOKEN_KEY, next);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

function handleUnauthorized(): void {
  setToken(null);
  authEvents.dispatchEvent(new Event('unauthorized'));
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (options.body && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, { ...options, headers, credentials: 'include' });
  } catch {
    throw new ApiError('Cannot reach the server. Check your connection.', 0);
  }

  if (response.status === 401) {
    handleUnauthorized();
  }

  const text = await response.text();
  const data = text ? safeJson(text) : null;

  if (!response.ok) {
    const message =
      data && typeof data === 'object' && 'error' in data
        ? String((data as { error: unknown }).error)
        : `Request failed (${response.status})`;
    throw new ApiError(message, response.status);
  }

  return data as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export const api = {
  login(email: string, password: string): Promise<LoginResponse> {
    return request<LoginResponse>('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  },

  async logout(): Promise<void> {
    try {
      await request<{ ok: boolean }>('/api/admin/logout', { method: 'POST' });
    } finally {
      setToken(null);
    }
  },

  me(): Promise<{ admin: { email: string } }> {
    return request('/api/admin/me');
  },

  listKnowledge(): Promise<{ items: KnowledgeSummary[]; count: number }> {
    return request('/api/admin/knowledge');
  },

  getKnowledge(id: number): Promise<{ item: KnowledgeEntry }> {
    return request(`/api/admin/knowledge/${id}`);
  },

  createText(input: {
    title: string;
    content: string;
    isActive: boolean;
  }): Promise<{ item: KnowledgeEntry }> {
    return request('/api/admin/knowledge/text', {
      method: 'POST',
      body: JSON.stringify({ title: input.title, content: input.content, is_active: input.isActive }),
    });
  },

  updateKnowledge(
    id: number,
    patch: { title?: string; content?: string; isActive?: boolean },
  ): Promise<{ item: KnowledgeEntry }> {
    return request(`/api/admin/knowledge/${id}`, {
      method: 'PUT',
      body: JSON.stringify({
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.content !== undefined ? { content: patch.content } : {}),
        ...(patch.isActive !== undefined ? { is_active: patch.isActive } : {}),
      }),
    });
  },

  deleteKnowledge(id: number): Promise<{ ok: boolean; id: number }> {
    return request(`/api/admin/knowledge/${id}`, { method: 'DELETE' });
  },

  /**
   * Uploads a PDF with real progress reporting. Uses XHR because fetch does not
   * expose upload progress.
   */
  uploadPdf(input: {
    file: File;
    title: string;
    isActive: boolean;
    onProgress?: (percent: number) => void;
  }): Promise<UploadResult> {
    return new Promise((resolve, reject) => {
      const form = new FormData();
      form.append('file', input.file);
      if (input.title.trim()) form.append('title', input.title.trim());
      form.append('is_active', String(input.isActive));

      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${API_BASE}/api/admin/knowledge/pdf`);
      xhr.withCredentials = true;
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.responseType = 'text';

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && input.onProgress) {
          input.onProgress(Math.round((event.loaded / event.total) * 100));
        }
      };

      xhr.onerror = () => reject(new ApiError('Upload failed. Check your connection.', 0));
      xhr.onabort = () => reject(new ApiError('Upload cancelled.', 0));
      xhr.onload = () => {
        const data = safeJson(xhr.responseText) as
          | { item?: KnowledgeEntry; pageCount?: number; error?: string }
          | null;

        if (xhr.status === 401) handleUnauthorized();

        if (xhr.status >= 200 && xhr.status < 300 && data?.item) {
          input.onProgress?.(100);
          resolve({ item: data.item, pageCount: data.pageCount ?? data.item.page_count });
          return;
        }
        reject(new ApiError(data?.error || `Upload failed (${xhr.status})`, xhr.status));
      };

      xhr.send(form);
    });
  },
};
