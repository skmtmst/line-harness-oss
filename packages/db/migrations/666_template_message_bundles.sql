-- B-324: API group 5, owner-approved 666-680. No remote DB application in this lane.
ALTER TABLE templates ADD COLUMN message_bubbles_json TEXT
  CHECK(message_bubbles_json IS NULL OR (json_valid(message_bubbles_json) AND json_type(message_bubbles_json)='array' AND json_array_length(message_bubbles_json) BETWEEN 1 AND 5));
ALTER TABLE templates ADD COLUMN draft_message_bubbles_json TEXT
  CHECK(draft_message_bubbles_json IS NULL OR (json_valid(draft_message_bubbles_json) AND json_type(draft_message_bubbles_json)='array' AND json_array_length(draft_message_bubbles_json) BETWEEN 1 AND 5));
ALTER TABLE template_versions ADD COLUMN message_bubbles_json TEXT
  CHECK(message_bubbles_json IS NULL OR (json_valid(message_bubbles_json) AND json_type(message_bubbles_json)='array' AND json_array_length(message_bubbles_json) BETWEEN 1 AND 5));
ALTER TABLE template_versions ADD COLUMN hq_template_version_id TEXT;
CREATE INDEX template_versions_hq_source ON template_versions(template_id,hq_template_version_id,version_number);
