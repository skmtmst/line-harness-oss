-- 449: 広告連携の秘密を暗号化して別保管し、疎通確認の記録を持つ。
-- config は秘密以外の値だけを平文JSONで持ち、秘密は config_encrypted
-- (AES-GCM)へ移す。旧行の平文 config はそのまま読める(移行期間の互換)。
ALTER TABLE ad_platforms ADD COLUMN config_encrypted TEXT;
-- 外部への疎通確認が通った日時。空のまま有効化はできない。
ALTER TABLE ad_platforms ADD COLUMN verified_at TEXT;
