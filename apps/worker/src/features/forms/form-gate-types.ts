import type { FormLayout } from '@line-crm/shared';
/** 回答1件。キーは入力ブロックの name。 */
export type FormAnswers = Record<string, unknown>;

export interface FormGateInput {
  db: D1Database;
  formId: string;
  layout: FormLayout;
  friendId: string;
  /** forms.submit_count。総数制限の判定に使う */
  submitCount: number;
  answers: FormAnswers;
  /** 判定の基準時刻。テストから固定できるようにしてある */
  now?: Date;
  /**
   * P（試し回答）：true のとき、1人1回・全体上限・選択肢定員を見ない。
   * 試しは本物の枠を消費せず、本物の回答歴にも数えない。入力の形と
   * 回答期限は本物と同じに見る。
   */
  isTest?: boolean;
  /** 同じキー・本文・本人で照合できた保存済み回答の後処理再開。 */
  resumeSavedAnswer?: boolean;
}
