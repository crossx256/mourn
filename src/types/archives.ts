export interface Archive {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  content: string;
  isPublic: boolean;
  createdAt: string;
  updatedAt: string;
  encrypted?: boolean;
  canEdit?: boolean;
}

export interface ArchiveListItem {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  isPublic: boolean;
  createdAt: string;
  updatedAt: string;
  encrypted?: boolean;
}

export interface ArchivePermissions {
  allowedUsers: ArchiveUser[];
  editors: ArchiveUser[];
}

export interface ArchiveUser {
  id: string;
  username: string;
}

export interface ArchiveAdminItem extends ArchiveListItem {
  content: string;
  allowedUsers: ArchiveUser[];
  editors: ArchiveUser[];
}
