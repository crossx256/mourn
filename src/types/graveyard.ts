export type PostStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface Letter {
  id: string;
  serialId: number | null;
  content: string;
  alias?: string | null;
  status: PostStatus;
  createdAt: string | Date;

  // Spatial coordinates for the 3D Void
  x: number;
  y: number;
  z: number;

  // Connections
  mentions?: Array<{ id: string; serialId?: number | null; alias?: string | null }>;
  mentionedBy?: Array<{ id: string; serialId?: number | null; alias?: string | null }>;
}

export interface GraveyardStatus {
  lastAttempt: string | null;
  cooldownDays: number;
  canSubmit: boolean;
  remainingMs: number;
}

export interface GraveyardState {
  letters: Letter[];
  loading: boolean;
  status: GraveyardStatus | null;
}
