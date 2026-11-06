export interface TemplateVersionRow {
  id: string;
  template_id: string;
  version_number: number;
  message_type: string;
  message_content: string;
  message_bubbles_json?: string | null;
  carousel_actions_json: string | null;
  carousel_tap_limit_mode: string | null;
  carousel_tap_limit_text: string | null;
  question_json: string | null;
  question_status: string | null;
  /** 使い始めの日時。空は「公開と同時」。 */
  effective_from: string | null;
  created_by_staff_id: string | null;
  created_at: string;
}
