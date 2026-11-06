import { FormChoiceRow, ChoiceInput } from './forms/controls.js';

/** 確認画面とフォームで同じ会い方の選択を使う。保存は呼ぶ側が持つ。 */
export default function MeetingModeChoices({ name, meetingMode, disabled, onChange }: {
  name: string;
  meetingMode: 'online' | 'in_person' | null;
  disabled?: boolean;
  onChange: (mode: 'online' | 'in_person') => void;
}) {
  return <fieldset className="space-y-2">
    <legend className="mb-2 text-sm font-bold text-ink">会い方を選んでください</legend>
    {(['online', 'in_person'] as const).map((mode) => <FormChoiceRow key={mode} selected={meetingMode === mode}>
      <ChoiceInput type="radio" name={name} value={mode} checked={meetingMode === mode} disabled={disabled} onChange={() => onChange(mode)} />
      {mode === 'online' ? 'オンライン' : '対面'}
    </FormChoiceRow>)}
  </fieldset>;
}
