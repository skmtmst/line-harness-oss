/** LINEでキーワードに当たらなかったときの返事。nullなら送らず未読を残す。 */
export interface AutoReplyUnmatchedSettings {
  lineAccountId: string;
  message: string | null;
  version: number;
  updatedBy: string | null;
  updatedAt: string | null;
}
export interface AutoReplyUnmatchedInput {
  message: string | null;
  expectedVersion: number;
}
