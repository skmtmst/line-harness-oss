/** ec.site.publication_viewed: 日付ありはその日の累計、なしは互換の生涯累計。 */
export interface PublicationViewSample {
  photo_id?: string | number | null;
  view_count?: number | null;
  placement_label?: string | null;
  view_date?: string;
}

export interface PublicationThirtyDayCount { view_count_30_days?: number | null }

/** V8: 全掲載の順序と、読み込んだ時点の版。 */
export type PhotoPublicationOrderInput = {
  accountId: string;
  items: Array<{ id: string; expectedVersion: number }>;
};

export type PhotoPublicationPublishResult = { id: string; version: number; status: 'published' };
