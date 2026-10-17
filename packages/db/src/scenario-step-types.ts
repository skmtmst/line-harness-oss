export type MessageType = 'text' | 'image' | 'flex' | 'location' | 'video' | 'audio' | 'sticker' | 'carousel' | 'imagemap' | 'rich_message' | 'coupon';

export interface ScenarioStep {
  id: string;
  scenario_id: string;
  step_order: number;
  delay_minutes: number;
  message_type: MessageType;
  message_content: string;
  message_bubbles_json?: string | null;
  condition_type: string | null;
  condition_value: string | null;
  next_step_on_false: number | null;
  offset_days: number | null;
  offset_minutes: number | null;
  delivery_time: string | null;
  template_id: string | null;
  on_reach_tag_id: string | null;
  /** この通を送ったあと。'continue' で次へ、'pause' で止める（113 で追加） */
  after_send: string;
  /** 1通ごとの配信対象（124）。SegmentCondition の JSON。null は購読中の全員。 */
  target_condition_json: string | null;
  /** 質問メッセージ（125）。ScenarioQuestion の JSON。null なら質問ではない。 */
  question_json: string | null;
  /** 下書き（126）。1 なら配信しない。 */
  is_draft: number;
  created_at: string;
}
