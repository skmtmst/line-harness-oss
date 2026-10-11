import { TextArea, FieldLabel } from './forms/controls.js';

/** 両配備入口で使う質問欄。送信の処理は呼び側が持つ。 */
export default function BookingIntake({ question, value, onChange }: {
  question?: string | null; value: string; onChange: (value: string) => void;
}) {
  return <div className="space-y-1.5">
    <FieldLabel htmlFor="booking-note">{question?.trim() || 'ご要望'}</FieldLabel>
    <TextArea id="booking-note" value={value} onChange={e => onChange(e.target.value)} rows={3}
      placeholder={question?.trim() ? undefined : '例：前髪は短めにしたい'} />
  </div>;
}
