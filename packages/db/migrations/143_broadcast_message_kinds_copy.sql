INSERT INTO broadcasts_new (
  id, title, message_type, message_content, target_type, target_tag_id,
  status, scheduled_at, sent_at, total_count, success_count, created_at,
  line_account_id, alt_text, line_request_id, aggregation_unit,
  batch_offset, segment_conditions, account_ids, dedup_priority, failed_account_ids,
  dedup_progress, batch_lock_at, track_links, message_bubbles_json, stealth_spread_minutes
)
SELECT
  id, title, message_type, message_content, target_type, target_tag_id,
  status, scheduled_at, sent_at, total_count, success_count, created_at,
  line_account_id, alt_text, line_request_id, aggregation_unit,
  batch_offset, segment_conditions, account_ids, dedup_priority, failed_account_ids,
  dedup_progress, batch_lock_at, track_links, message_bubbles_json, stealth_spread_minutes
FROM broadcasts;
