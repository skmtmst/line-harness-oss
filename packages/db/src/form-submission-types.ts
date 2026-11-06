export interface FormSubmission {
  id: string;
  form_id: string;
  friend_id: string | null;
  form_version_id: string | null;
  /** P（試し回答）：1 は公開前の試し。集計・一覧・書き戻しに出さない。 */
  is_test: number;
  data: string; // JSON string
  destination_write_status: FormDestinationWriteStatus;
  destination_write_attempted: number | null;
  destination_write_succeeded: number | null;
  destination_write_failed: number | null;
  destination_write_completed_at: string | null;
  created_at: string;
}

export type FormDestinationWriteStatus =
  | 'pending'
  | 'succeeded'
  | 'partial'
  | 'failed'
  | 'not_requested'
  | 'unknown';
