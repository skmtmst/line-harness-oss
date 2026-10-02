-- マイペットの「体重の更新」はプロフィール全体の更新日（updated_at）を
-- 見ていたため、名前だけの編集でも「体重を測り直した日」が動いていた（監査 R57）。
-- 体重を測った・直した日だけを持つ列を足す。空欄を許すので既存の行は壊れない。
--
-- 既存の行への引き継ぎ：いちばん新しい「体重つきの健康日記」の記録日を入れる。
-- 日記が無い行は従来どおりプロフィールの更新日を入れ、表示が今より古くなる
-- ことはない。

ALTER TABLE nen_pet_profiles ADD COLUMN weight_updated_at TEXT;

UPDATE nen_pet_profiles
   SET weight_updated_at = COALESCE(
     (SELECT MAX(h.logged_on)
        FROM nen_health_logs h
       WHERE h.pet_id = nen_pet_profiles.id
         AND h.weight_kg IS NOT NULL),
     updated_at
   );
