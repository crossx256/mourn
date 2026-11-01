import type { Announcement } from 'src/types/system';
import type { APILeaderboardProfile } from 'src/types/leaderboard';
import type { User } from 'src/types/auth';

export interface ApiResponseEnvelope<T> {
  data?: T;
  error?: string;
  message?: string;
  success?: boolean;
  code?: string;
}

export interface LandingStatsPayload {
  count?: number;
}

export interface LandingLeaderboardPayload {
  data?: APILeaderboardProfile[];
}

export interface LandingAnnouncementsPayload {
  data?: Announcement[];
}

export interface CsrfResponsePayload {
  csrfToken?: string;
}

export interface LoginResponsePayload {
  user?: User;
  verificationRequired?: boolean;
}

export interface MobileAuthCredentialsPayload {
  token: string;
  csrfToken: string;
  tokenExpiresIn: number;
}

export interface MobileLoginResponsePayload
  extends ApiResponseEnvelope<LoginResponsePayload>, MobileAuthCredentialsPayload {}

export interface MobileDeviceRegistrationPayload {
  success: boolean;
  error?: string;
  device?: {
    id?: string;
    deviceHash?: string;
  };
  deviceId?: string;
  deviceToken?: string;
  tokenExpiresIn?: number;
  token?: string;
  csrfToken?: string;
  authTokenExpiresIn?: number;
}

export interface MobileSessionRecord {
  token: string;
  csrfToken: string;
  issuedAt: number;
  expiresAt: number;
  username: string;
  deviceHash?: string;
  deviceId?: string;
}

export interface MobileDeviceBindingRecord {
  username: string;
  deviceHash: string;
  deviceId?: string;
}
