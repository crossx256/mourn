// Report + support tickets — user-facing types.
//
// Mirrors the backend contract (routes/api/v1/ticket.routes.js +
// utils/ticketValidation.js). The server is the enforcement boundary; these
// lists power the pickers and must stay in sync with it.

export type TicketType = 'support' | 'report';
export type TicketStatus = 'pending' | 'in_progress' | 'resolved';
export type TicketTargetType = 'message' | 'suite' | 'letter' | 'profile';

export const SUPPORT_CATEGORIES = ['account', 'bug', 'question', 'feature', 'other'] as const;

/** The report taxonomy (union of the general list + the profile sub-categories). */
export const REPORT_CATEGORIES = [
  'spam',
  'harassment',
  'inappropriate',
  'inappropriate_content',
  'impersonation',
  'misinformation',
  'violence',
  'self_harm',
  'other',
] as const;

/** What a PROFILE report offers (§4d). */
export const PROFILE_REPORT_CATEGORIES = [
  'impersonation',
  'inappropriate_content',
  'spam',
  'other',
] as const;

export const MAX_TICKET_ATTACHMENTS = 3;
export const MAX_TICKET_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const TICKET_DESCRIPTION_MIN = 10;
export const TICKET_DESCRIPTION_MAX = 4000;

export interface Ticket {
  id: string;
  /** Short display reference supplied by the server, e.g. "8F14E45F". */
  reference: string;
  type: TicketType;
  status: TicketStatus;
  category: string;
  customCategory: string | null;
  description: string;
  attachments: string[];
  targetType: TicketTargetType | null;
  targetRef: string | null;
  targetLabel: string | null;
  messageContent?: string | null;
  resolution: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TicketPaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface TicketListPayload {
  tickets: Ticket[];
}

/** Body of POST /api/v1/tickets. */
export interface TicketCreatePayload {
  type: TicketType;
  category: string;
  customCategory?: string;
  description: string;
  targetType?: TicketTargetType;
  targetRef?: string;
  /** Reporter-selected message text (message/thread reports only). */
  messageContent?: string;
  attachments?: string[];
}

/**
 * What an entry point hands to the composer so the target is pre-filled and
 * the inapplicable fields are hidden (§4a–§4d).
 */
export interface TicketTargetPrefill {
  targetType: TicketTargetType;
  targetRef: string;
  /** Human hint shown above the form while the server re-resolves the label. */
  label?: string;
  /**
   * For message targets: the text the reporter wants included. A single-message
   * report passes that message's text; a thread report passes the delimited
   * selected messages.
   */
  messageContent?: string;
  /** Restricts the category picker to the profile sub-categories (§4d). */
  categoryScope?: 'profile';
}

export interface TicketReportSearchUser {
  id: string;
  username: string;
}

export interface TicketLetterFinderResult {
  id: string;
  serialId: number | null;
  alias: string | null;
  content: string;
}

export interface TicketSuiteFinderResult {
  id: string;
  name: string;
}

export type TicketComposerTargetKind = TicketTargetType;
