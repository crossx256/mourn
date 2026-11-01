export interface Announcement {
  id: string;
  title: string;
  body: string;
  isActive: boolean;
  createdAt: string;
}

export interface AdminStats {
  totalUsers: number;
  activeUsers: number;
  activeSessions: number;
  activeAnnouncements: number;
}

export interface AdminUser {
  id: string;
  username: string;
  email: string | null;
  isActive: boolean;
  isBanned: boolean;
  createdAt: string;
  inviteCount: number;
  lastActivityAt: string | null;
  activeNow: boolean;
}

export interface AuditLog {
  id: string;
  eventType: string;
  ipAddress: string | null;
  success: boolean;
  createdAt: string;
  metadata?: Record<string, unknown>;
}
