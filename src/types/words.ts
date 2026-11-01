export interface WordQuote {
  id: string;
  content: string;
  author: string;
  weight: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WordQuoteDraft {
  content: string;
  author: string;
  weight: number;
  isActive: boolean;
}
