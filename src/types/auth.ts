export enum EventType {
  REGISTRATION_ATTEMPT = 'REGISTRATION_ATTEMPT',
  REGISTRATION_SUCCESS = 'REGISTRATION_SUCCESS',
  LOGIN_ATTEMPT = 'LOGIN_ATTEMPT',
  LOGIN_SUCCESS = 'LOGIN_SUCCESS',
  LOGIN_FAILURE = 'LOGIN_FAILURE',
  LOGOUT = 'LOGOUT',
  PASSWORD_CHANGE = 'PASSWORD_CHANGE',
  PASSWORD_RESET_REQUEST = 'PASSWORD_RESET_REQUEST',
  PASSWORD_RESET_SUCCESS = 'PASSWORD_RESET_SUCCESS',
  EMAIL_VERIFICATION = 'EMAIL_VERIFICATION',
  SESSION_CREATED = 'SESSION_CREATED',
  SESSION_EXPIRED = 'SESSION_EXPIRED',
  ACCOUNT_LOCKED = 'ACCOUNT_LOCKED',
  SUSPICIOUS_ACTIVITY = 'SUSPICIOUS_ACTIVITY',
  ACCOUNT_BANNED = 'ACCOUNT_BANNED',
  ADMIN_ACCESS_GRANTED = 'ADMIN_ACCESS_GRANTED',
  ADMIN_NOT_ADMIN = 'ADMIN_NOT_ADMIN',
  ADMIN_LOCKOUT = 'ADMIN_LOCKOUT',
  ADMIN_IP_CHANGED = 'ADMIN_IP_CHANGED',
  ADMIN_UA_CHANGED = 'ADMIN_UA_CHANGED',
  ADMIN_CSRF_INVALID = 'ADMIN_CSRF_INVALID',
  ADMIN_BAN_CLUSTER = 'ADMIN_BAN_CLUSTER',
  ADMIN_BAN_CLUSTER_ERROR = 'ADMIN_BAN_CLUSTER_ERROR',
  ADMIN_NO_SESSION = 'ADMIN_NO_SESSION',
  ADMIN_USER_NOT_FOUND = 'ADMIN_USER_NOT_FOUND',
  ADMIN_INACTIVE_OR_BANNED = 'ADMIN_INACTIVE_OR_BANNED',
  ADMIN_IP_NOT_WHITELISTED = 'ADMIN_IP_NOT_WHITELISTED',
  ADMIN_ERROR = 'ADMIN_ERROR',
}

export interface User {
  id: string;
  username: string;
  email: string | null;
  emailVerified: boolean;
  isActive: boolean;
  isDonator: boolean;
  isAdmin: boolean;
  createdAt: string;
  hasAcceptedTerms: boolean;
  profile?: { profilePicture?: string | null; displayName?: string | null };
}

export interface LoginCredentials {
  username: string;
  password: string;
}

interface RegisterAccountCredentials {
  username: string;
  email: string;
  password: string;
  confirmPassword: string;
}

export interface LegacyRegisterCredentials extends RegisterAccountCredentials {
  referralCode: string;
  activationToken?: never;
}

export interface ActivationRegisterCredentials extends RegisterAccountCredentials {
  activationToken: string;
  referralCode?: never;
}

export type RegisterCredentials = LegacyRegisterCredentials | ActivationRegisterCredentials;

export interface AuthState {
  user: User | null;
  isLoggedIn: boolean;
  csrfToken: string;
  authOperationGeneration: number;
}
