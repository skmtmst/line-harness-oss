/** 統括のひな形一覧にだけ付く表示用の材料。本文や画像URLは含めない。 */
export interface HqTemplateListDisplay {
  /** 配布に成功したアカウントの現在の表示名。名前順、最大3件。同じアカウントは1件。 */
  distributed_account_names: string[];
  /** 表示した3件を除いたアカウント数。 */
  distributed_account_more: number;
  distributed_account_count: number;
  /** 種類と件数の短い要約。最新の内容を確認できない場合はnull。 */
  content_summary: string | null;
}
