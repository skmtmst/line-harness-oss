
export interface SavedSearchUsageCount {
  saved_search_id: string;
  call_count_this_month: number;
}


export interface SavedSearchReferenceUsageCount extends SavedSearchUsageCount {
  reference_kind: string;
  reference_id: string | null;
}
