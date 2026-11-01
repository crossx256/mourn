export interface LeaderboardProfile {
  username: string;
  reputation?: number | null;
  referrals?: number | null;
  contribution?: number | null;
  profilePicture?: string | null;
}

export interface APILeaderboardProfile {
  reputation?: number;
  referrals?: number;
  contribution?: number;
  profilePicture?: string | null;
  username: string;
}
