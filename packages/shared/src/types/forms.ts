export interface FormSubmissionPostActions {
  state: 'completed' | 'failed' | 'in_progress' | 'untracked';
  pending: string[];
  /** 記録された済み工程。過去の記録で日時が不明ならnull。 */
  completed: Array<{ step: string; completedAt: string | null }>;
}

export interface FormSubmissionDetail {
  id: string;
  formId: string;
  formVersionId: string | null;
  friendId: string | null;
  friendName: string | null;
  data: Record<string, unknown>;
  destinationWrite: {
    status: 'pending' | 'succeeded' | 'partial' | 'failed' | 'not_requested' | 'unknown';
    attempted: number | null;
    succeeded: number | null;
    failed: number | null;
  };
  postActions: FormSubmissionPostActions | null;
  createdAt: string;
}

export interface FormSubmissionPage {
  period?: { from?: string; until?: string };
  items: FormSubmissionDetail[];
  total: number;
  page: number;
  limit: number;
  summary: {
    startedUnique: number;
    submitted: number;
    completionRate: number | null;
    destinationWrites: Record<FormSubmissionDetail['destinationWrite']['status'], number>;
    dateAnsweredUniqueFriends: number;
    dateFields: Array<{ key: string; label: string; answered: number; uniqueFriends: number; minDate: string | null; maxDate: string | null }>;
    ratingFields: Array<{ key: string; label: string; answered: number; average: number | null }>;
  };
}
