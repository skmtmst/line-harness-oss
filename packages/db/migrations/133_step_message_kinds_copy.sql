-- 中身を移す。列名を明示するのは、並び順が変わっても壊れないようにするため。
INSERT INTO scenario_steps_new (
  id, scenario_id, step_order, delay_minutes, message_type, message_content,
  message_bubbles_json, offset_days, offset_minutes, delivery_time,
  template_id, on_reach_tag_id, created_at,
  condition_type, condition_value, next_step_on_false, after_send,
  target_condition_json, question_json, is_draft
)
SELECT
  id, scenario_id, step_order, delay_minutes, message_type, message_content,
  message_bubbles_json, offset_days, offset_minutes, delivery_time,
  template_id, on_reach_tag_id, created_at,
  condition_type, condition_value, next_step_on_false, after_send,
  target_condition_json, question_json, is_draft
FROM scenario_steps;
