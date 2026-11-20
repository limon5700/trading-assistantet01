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

export type AccountStatus = 'PENDING' | 'ACTIVE' | 'SUSPENDED';

export interface AdminUser {
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

export interface UserStats {
  TOTAL: number;
  PENDING: number;
  ACTIVE: number;
  SUSPENDED: number;
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

export interface PlanInput {
  name: string;
  plan_type: 'FREE' | 'PAID';
  price: number;
  duration_days: number;
  description: string;
  features: string[];
  is_active: boolean;
}

export interface ActivationCode {
  id: number;
  code: string;
  assigned_user_id: number | null;
  assigned_user_name: string | null;
  assigned_username: string | null;
  plan_id: number;
  plan_name: string | null;
  is_used: boolean;
  used_by_user_id: number | null;
  used_by_user_name: string | null;
  used_at: string | null;
  expires_at: string | null;
  created_at: string;
}

export interface AppSettings {
  affiliate_link: string;
  support_contact_link: string;
  app_name: string;
  default_plan_type: string;
  crypto_network: 'BEP20' | 'TRC20';
  crypto_wallet_address: string;
  bscscan_api_key: string;
  trongrid_api_key: string;
}

export type ActivityAction =
  | 'SIGNUP'
  | 'LOGIN'
  | 'ACTIVATED'
  | 'SIGNAL_SCAN'
  | 'SETTINGS_UPDATED'
  | 'PAYMENT_VERIFIED';

export interface Activity {
  id: number;
  user_id: number;
  full_name: string;
  username: string;
  email: string;
  action: ActivityAction;
  details: string | null;
  created_at: string;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
