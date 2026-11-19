import { loadServerUrl } from './settings';

export type AccountStatus = 'PENDING' | 'ACTIVE' | 'SUSPENDED';

export interface AuthUser {
  id: number;
  full_name: string;
  username: string;
  email: string;
  phone: string | null;
  account_status: AccountStatus;
  active_plan_id: number | null;
  active_plan_name: string | null;
  activation_code_used: string | null;
  last_active_at: string | null;
  created_at: string;
}

export interface Plan {
  id: number;
  name: string;
  plan_type: 'FREE' | 'PAID';
  price: number;
  duration_days: number;
  description: string;
  features: string[];
  is_active: boolean;
  created_at: string;
}

export interface AppSettings {
  affiliate_link: string;
  support_contact_link: string;
  app_name?: string;
  default_plan_type?: string;
}

export interface SessionPayload {
  user: AuthUser;
  settings: AppSettings;
  plans: Plan[];
}

export interface AuthResponse extends SessionPayload {
  token: string;
}

export interface SignupInput {
  full_name: string;
  username: string;
  email: string;
  phone: string;
  password: string;
  confirm_password: string;
}

export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  token?: string | null;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const base = loadServerUrl();
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.token) headers.Authorization = `Bearer ${options.token}`;

  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new ApiError('Cannot reach the server. Check your connection and the server URL.', 0);
  }

  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    const payload = (data ?? {}) as { error?: string; code?: string };
    throw new ApiError(
      payload.error || `Request failed (${response.status})`,
      response.status,
      payload.code,
    );
  }

  return data as T;
}

export const userApi = {
  signup(input: SignupInput): Promise<AuthResponse> {
    return request<AuthResponse>('/api/auth/signup', { method: 'POST', body: input });
  },

  login(identifier: string, password: string): Promise<AuthResponse> {
    return request<AuthResponse>('/api/auth/login', {
      method: 'POST',
      body: { identifier, password },
    });
  },

  me(token: string): Promise<SessionPayload> {
    return request<SessionPayload>('/api/auth/me', { token });
  },

  activate(token: string, activationCode: string): Promise<SessionPayload> {
    return request<SessionPayload>('/api/auth/activate', {
      method: 'POST',
      token,
      body: { activation_code: activationCode },
    });
  },
};
