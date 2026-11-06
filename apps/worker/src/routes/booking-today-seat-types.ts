export interface TodaySeatRow {
  customer_version: number;
  table_id: string | null;
  table_ids_json: string;
  source: string;
  kind: 'seat';
  id: string;
  store_id: string;
  store_name: string;
  starts_at: string;
  ends_at: string;
  status: string;
  customer_name: string;
  guest_count: number;
  table_label: string | null;
  course_name: string | null;
  visit_mark: {
    kind: string;
    late_minutes: number | null;
    marked_by_name: string | null;
    marked_at: string;
  } | null;
}
