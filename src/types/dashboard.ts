// Invite Tree Node for UserInviteTree.vue
export interface DashboardInviteTreeNode {
  id: string;
  username: string;
  createdAt: string;
  isBanned: boolean;
  parentId: string | null;
  children: DashboardInviteTreeNode[];
  x: number;
  y: number;
  depth: number;
  subtreeWidth: number;
  childCount: number;
}
// Dashboard Types - Re-exports Profile from profile.ts

import type { Profile } from './profile';

export type { Profile };

export interface DashboardUser {
  id: string;
  username: string;
  email: string | null;
  emailVerified: boolean;
  isDonator: boolean;
  isBanned: boolean;
  isAdmin: boolean;
  createdAt: string;
  referralCount: number;
  referredBy: string | null;
}

export interface DashboardData {
  user: DashboardUser;
  profile: Profile;
}

export interface SocialLink {
  key: string;
  label: string;
  icon: string;
  placeholder: string;
}

export const SOCIAL_LINKS: SocialLink[] = [
  {
    key: 'twitter',
    label: 'Twitter/X',
    icon: 'fab fa-twitter',
    placeholder: 'https://twitter.com/username',
  },
  {
    key: 'discord',
    label: 'Discord',
    icon: 'fab fa-discord',
    placeholder: 'discord username or invite',
  },
  {
    key: 'telegram',
    label: 'Telegram',
    icon: 'fab fa-telegram',
    placeholder: 'https://t.me/username',
  },
  {
    key: 'instagram',
    label: 'Instagram',
    icon: 'fab fa-instagram',
    placeholder: 'https://instagram.com/username',
  },
  {
    key: 'github',
    label: 'GitHub',
    icon: 'fab fa-github',
    placeholder: 'https://github.com/username',
  },
  {
    key: 'youtube',
    label: 'YouTube',
    icon: 'fab fa-youtube',
    placeholder: 'https://youtube.com/@channel',
  },
  {
    key: 'twitch',
    label: 'Twitch',
    icon: 'fab fa-twitch',
    placeholder: 'https://twitch.tv/username',
  },
  {
    key: 'tiktok',
    label: 'TikTok',
    icon: 'fab fa-tiktok',
    placeholder: 'https://tiktok.com/@username',
  },
  {
    key: 'spotify',
    label: 'Spotify',
    icon: 'fab fa-spotify',
    placeholder: 'https://open.spotify.com/user/username',
  },
  {
    key: 'roblox',
    label: 'Roblox',
    icon: 'fas fa-gamepad',
    placeholder: 'https://roblox.com/users/userid',
  },
  {
    key: 'steam',
    label: 'Steam',
    icon: 'fab fa-steam',
    placeholder: 'https://steamcommunity.com/id/username',
  },
  {
    key: 'pinterest',
    label: 'Pinterest',
    icon: 'fab fa-pinterest',
    placeholder: 'https://pinterest.com/username',
  },
  {
    key: 'vsco',
    label: 'VSCO',
    icon: 'fas fa-camera',
    placeholder: 'https://vsco.co/username',
  },
];
