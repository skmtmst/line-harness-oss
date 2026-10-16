/** フォームの項目定義。forms.fields は JSON の配列で持っている。 */
export interface FormFieldDef {
  id?: string;
  name?: string;
  label?: string;
  type?: string;
  /** 回答の登録先。友だち情報欄の項目ID。未設定なら情報欄には書かない */
  friendFieldId?: string | null;
}
