import type {
  ActivationCode,
  Activity,
  ActivityAction,
  AdminUser,
  AppSettings,
  KnowledgeEntry,
  KnowledgeSummary,
  LoginResponse,
  Paged,
  Plan,
  PlanInput,
  UploadResult,
  UserStats,
} from './types';

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

  /* ------------------------------------------------------------ settings -- */

  getSettings(): Promise<{ settings: AppSettings }> {
    return request('/api/admin/settings');
  },

  updateSettings(patch: Partial<AppSettings>): Promise<{ settings: AppSettings }> {
    return request('/api/admin/settings', { method: 'PUT', body: JSON.stringify(patch) });
  },

  /* --------------------------------------------------------------- plans -- */

  listPlans(): Promise<{ items: Plan[] }> {
    return request('/api/admin/plans');
  },

  createPlan(input: PlanInput): Promise<{ item: Plan }> {
    return request('/api/admin/plans', { method: 'POST', body: JSON.stringify(input) });
  },

  updatePlan(id: number, input: Partial<PlanInput>): Promise<{ item: Plan }> {
    return request(`/api/admin/plans/${id}`, { method: 'PUT', body: JSON.stringify(input) });
  },

  deletePlan(id: number): Promise<{ ok: boolean; id: number }> {
    return request(`/api/admin/plans/${id}`, { method: 'DELETE' });
  },

  /* ---------------------------------------------------- activation codes -- */

  listActivationCodes(input: {
    status?: '' | 'used' | 'unused' | 'expired';
    page?: number;
    pageSize?: number;
  } = {}): Promise<Paged<ActivationCode>> {
    const params = new URLSearchParams();
    if (input.status) params.set('status', input.status);
    if (input.page) params.set('page', String(input.page));
    if (input.pageSize) params.set('page_size', String(input.pageSize));
    const query = params.toString();
    return request(`/api/admin/activation-codes${query ? `?${query}` : ''}`);
  },

  generateActivationCode(input: {
    userId: number;
    planId: number;
    expiresInDays?: number | null;
  }): Promise<{ item: ActivationCode }> {
    return request('/api/admin/activation-codes/generate', {
      method: 'POST',
      body: JSON.stringify({
        user_id: input.userId,
        plan_id: input.planId,
        ...(input.expiresInDays ? { expires_in_days: input.expiresInDays } : {}),
      }),
    });
  },

  deleteActivationCode(id: number): Promise<{ ok: boolean; id: number }> {
    return request(`/api/admin/activation-codes/${id}`, { method: 'DELETE' });
  },

  /* --------------------------------------------------------------- users -- */

  listUsers(input: {
    search?: string;
    status?: '' | 'PENDING' | 'ACTIVE' | 'SUSPENDED';
    page?: number;
    pageSize?: number;
  } = {}): Promise<Paged<AdminUser> & { stats: UserStats }> {
    const params = new URLSearchParams();
    if (input.search) params.set('search', input.search);
    if (input.status) params.set('status', input.status);
    if (input.page) params.set('page', String(input.page));
    if (input.pageSize) params.set('page_size', String(input.pageSize));
    const query = params.toString();
    return request(`/api/admin/users${query ? `?${query}` : ''}`);
  },

  updateUserStatus(
    id: number,
    patch: { accountStatus?: AdminUser['account_status']; activePlanId?: number | null },
  ): Promise<{ item: AdminUser }> {
    return request(`/api/admin/users/${id}/status`, {
      method: 'PUT',
      body: JSON.stringify({
        ...(patch.accountStatus !== undefined ? { account_status: patch.accountStatus } : {}),
        ...(patch.activePlanId !== undefined ? { active_plan_id: patch.activePlanId } : {}),
      }),
    });
  },

  deleteUser(id: number): Promise<{ ok: boolean; id: number }> {
    return request(`/api/admin/users/${id}`, { method: 'DELETE' });
  },

  /* ---------------------------------------------------------- activities -- */

  listActivities(input: {
    page?: number;
    pageSize?: number;
    action?: ActivityAction | '';
  } = {}): Promise<Paged<Activity>> {
    const params = new URLSearchParams();
    if (input.page) params.set('page', String(input.page));
    if (input.pageSize) params.set('page_size', String(input.pageSize));
    if (input.action) params.set('action', input.action);
    const query = params.toString();
    return request(`/api/admin/activities${query ? `?${query}` : ''}`);
  },
};
