-- 草稿：D1への適用は司令塔が承認を得てから行う。
-- 配布直後の名前を残す。過去の記録は推測で埋めない。
ALTER TABLE hq_template_distribution_results ADD COLUMN created_name TEXT;
