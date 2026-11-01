// =============================================
// Chains & Links — Type Definitions
// =============================================

export type LinkStatus = 'PENDING' | 'ESTABLISHED' | 'ANCHORED' | 'SEVERED';

export interface LinkUserDevice {
  id: string;
  devicePub: string;
  identityPub: string;
}

export interface LinkUser {
  id: string;
  username: string;
  isDonator: boolean;
  profile: {
    displayName: string | null;
    profilePicture: string | null;
  } | null;
  devices?: LinkUserDevice[];
}

export interface Link {
  id: string;
  senderId: string;
  receiverId: string;
  status: LinkStatus;
  establishedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  sender: LinkUser;
  receiver: LinkUser;
  unreadCount: number;
}

export interface SearchUser {
  id: string;
  username: string;
  isDonator: boolean;
  createdAt: string;
  linkStatus: LinkStatus | null;
  profile: {
    displayName: string | null;
    profilePicture: string | null;
    bio: string | null;
    reputation: number;
  } | null;
}
