-- N-059(#662): 送り始めた一斉配信を止め、失敗した相手だけを再送できるようにする。
--
-- これまで `sending` に入った配信を止める経路が無かった。止める口が無いだけ
-- でなく、**誰に届いて誰に届かなかったかを残す台帳が無い**。成功の記録は
-- messages_log にあるが、失敗と「送達不明」は どこにも残らない。だから
-- 「失敗した相手だけ送り直す」が原理的にできなかった。
--
-- ここで足すのは2つ。
--
-- 1. broadcasts の停止印（stopped_at / stopped_by / send_attempt_no）
--    status には足さない。status の CHECK を変えるには30列の表を作り直す
--    ことになり、broadcasts を指す子表が3つある。停止は送信の段階
--    （draft→scheduled→sending→sent）とは別の軸——「送信中だが、新しい
--    送信権をもう取らない」——なので、別の列で持つほうが既存の
--    `status = 'sending'` の意味を変えずに済む。**代わりに、送信中の行を
--    拾う口（getQueuedBroadcasts / recoverStalledBroadcasts / バッチ取得の
--    CAS）すべてに `stopped_at IS NULL` を足す。**足し忘れると停止が効かない
--    ので、そこは試験で固定する。
--
-- 2. 送達台帳 broadcast_send_claims（配信×相手に1行）
--    state は claimed / sent / failed / unknown。
--
--    **dispatched_at が要になる。**外部（LINE）へ投げる直前に立てる印で、
--    印が立っていて決着が付いていない行は「送ったかもしれない」。この現場の
--    既定は at-most-once（外へ出たかもしれない分は欠ける側に倒す）なので、
--    unknown は再送の対象にしない。二重に届くと受け手の記録に残って
--    取り消せないが、1回分欠けたほうはこの台帳に残るのでこちら側で気づける。
--    migration 358（friend_add_send_claims）と同じ考え方。
--
--    attempt_no は試行の番号。broadcasts.send_attempt_no と揃える。
--    「相手×配信×試行」で安定キーになり、provider（LINE）へ渡す
--    X-Line-Retry-Key もこの3つから作る。同じ試行の中での送り直しは
--    provider 側で重複が潰れ、試行をまたぐ再送は台帳側で成功・送達不明を
--    除くので、どちらの向きでも二重送信にならない。

ALTER TABLE broadcasts ADD COLUMN stopped_at TEXT;
ALTER TABLE broadcasts ADD COLUMN stopped_by TEXT;
ALTER TABLE broadcasts ADD COLUMN send_attempt_no INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS broadcast_send_claims (
  broadcast_id    TEXT NOT NULL REFERENCES broadcasts(id) ON DELETE CASCADE,
  friend_id       TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  line_account_id TEXT,
  attempt_no      INTEGER NOT NULL DEFAULT 1 CHECK (attempt_no >= 1),
  state           TEXT NOT NULL CHECK (state IN ('claimed', 'sent', 'failed', 'unknown')),
  dispatched_at   TEXT,
  settled_at      TEXT,
  error_code      TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  PRIMARY KEY (broadcast_id, friend_id)
);

-- 台帳の数え上げ（送達済み・失敗・送達不明）と、再送対象の抽出に使う。
CREATE INDEX IF NOT EXISTS idx_broadcast_send_claims_state
  ON broadcast_send_claims (broadcast_id, state);

-- 停止中の配信を拾わないための絞り込みに使う。
CREATE INDEX IF NOT EXISTS idx_broadcasts_stopped
  ON broadcasts (status, stopped_at);
