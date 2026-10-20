
/*
 * V6R-CX-a: 1本のAPIが、共通の段（CORS・回数制限・ログイン確認・テナント・伏せ字・
 * 監査・機能の強制）と本体のどこで時間を使っているかを Server-Timing で返す。
 *
 * 検証環境の実測では、友だち5人でも認証が要るAPIは1本0.3〜0.9秒かかり、往復だけの
 * 0.12〜0.17秒との差がサーバ内に残っていた。内訳が無いと、どこを軽くすべきか決められない。
 *
 * - 段の境目に timingMark を置き、前の印からの経過を「前の段の時間」として記録する
 * - 本体（handler）は最後の印から応答までの時間
 * - **ログイン済みの職員への応答だけに付ける。** 未ログインの相手に認証処理の
 *   時間差を見せない（なりすましの手がかりにさせない）
 * - ブラウザの計測（PerformanceResourceTiming.serverTiming）で読めるよう、
 *   CORS で許可した管理画面の origin にだけ Timing-Allow-Origin を付ける
 * - Workers の時計は I/O のときだけ進む。DB や外部APIの待ちは測れるが、CPU だけの
 *   処理は 0 に見える。それで十分（遅さの正体は待ち時間）
 */
export type ServerTiming = { last: number; start: number; parts: Array<{ name: string; dur: number }> };
