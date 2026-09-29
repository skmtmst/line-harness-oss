-- N-167(#751): フォームの全体上限・選択肢定員を、同時回答でも超えないようにする。
--
-- これまでの判定(checkFormGates)は「数えてから比べる」だけで、比べたあと
-- 保存するまでの間に別の回答が割り込む隙間があった。全体上限は
-- forms.submit_count、選択肢定員は form_submissions.data の実回答数を
-- 数えるが、どちらも読んでから書くまでが2手に分かれているため、
-- 2件が同時に読むと両方とも「まだ空きがある」と判定して両方通ってしまう。
--
-- 前例(migration 358 friend_add_send_claims・380 broadcast_send_claims)と
-- 同じ「条件付き INSERT 1本で決め、changes を見て勝った者だけが通る」形に
-- 揃える。数えてから入れるのではなく、**入れられた数だけが答え**にする。
--
-- slot_key で「全体」と「選択肢」を同じ表・同じ確保処理で扱う。
--   全体上限   … slot_key = '__total__'
--   選択肢定員 … slot_key = 'choice:' || block_name || ':' || choice_label
-- 1つの回答(submission_id)が複数の slot を同時に必要とすることがある
-- (定員つきの選択肢を選びつつ全体上限もある、等)。1つでも確保できなければ
-- 呼び出し側が確保済みの分を削除して回答自体を取り消す。
--
-- 同じ submission_id で同じ slot_key を2回確保しようとしても、
-- 主キーが重複するため2回目は素通り(INSERT が空)になる。冪等な再開でも
-- 二重に消費しない。

-- submission_id は Webhook より前に確保するため、form_submissions の行が
-- まだ無い段階で書くことがある。form_submit_claims.submission_id
-- (migration 348)と同じ理由で外部キーにしない。取り消しは呼び出し側が
-- 明示的に DELETE する(releaseFormCapacityClaims)。
CREATE TABLE IF NOT EXISTS form_capacity_claims (
  form_id       TEXT NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  slot_key      TEXT NOT NULL,
  submission_id TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  PRIMARY KEY (form_id, slot_key, submission_id)
);

-- 空き枠の判定(COUNT)と、確保済み分の取り消し(submission_id 指定)の両方に使う。
CREATE INDEX IF NOT EXISTS idx_form_capacity_claims_slot
  ON form_capacity_claims (form_id, slot_key);
CREATE INDEX IF NOT EXISTS idx_form_capacity_claims_submission
  ON form_capacity_claims (form_id, submission_id);
