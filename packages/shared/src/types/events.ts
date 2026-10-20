/** 保存前のイベント申込ページ。予約や公開を行わない。 */
export interface EventApplicationPreview {
  name: string;
  description: string | null;
  venueName: string | null;
  venueAddress: string | null;
  venueUrl: string | null;
  startsAt: string;
  endsAt: string;
  capacity: number;
  requiresApproval: boolean;
  questions: Array<{ id: string; label: string; required: boolean; type: string }>;
  previewOnly: true;
}
