export interface ConversationMessage {
  id: string;
  direction: 'incoming' | 'outgoing';
  messageType: string;
  content: string;
  isUnsent: boolean;
  createdAt: string;
  eventAt: string | null;
}
export interface ConversationCursor {
  at: string;
  id: string;
}
export interface ConversationMessagePage {
  messages: ConversationMessage[];
  total: number;
  beforeCursor: ConversationCursor | null;
  afterCursor: ConversationCursor | null;
}
export interface ConversationSearchHit {
  id: string;
  at: string;
  excerpt: string;
  before: { id: string; excerpt: string } | null;
  after: { id: string; excerpt: string } | null;
  cursor: ConversationCursor;
}
export interface ConversationSearchResult {
  total: number;
  hits: ConversationSearchHit[];
  nextOffset: number | null;
}
