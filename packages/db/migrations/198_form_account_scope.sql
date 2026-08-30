-- 回答フォームを、選択中のLINE公式アカウントへ明示的に所属させる。
-- 1つのフォームを複数アカウントで使う場合も、この対応表に利用先を並べる。
CREATE TABLE IF NOT EXISTS form_accounts (
  form_id         TEXT NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  PRIMARY KEY (form_id, line_account_id)
);

CREATE INDEX IF NOT EXISTS idx_form_accounts_account
  ON form_accounts(line_account_id, form_id);

-- 回答済みの友だちから利用先が分かる既存フォーム。
INSERT OR IGNORE INTO form_accounts (form_id, line_account_id)
SELECT DISTINCT fs.form_id, fr.line_account_id
FROM form_submissions fs
JOIN friends fr ON fr.id = fs.friend_id
WHERE fr.line_account_id IS NOT NULL;

-- リッチメニューから開く既存フォーム。
INSERT OR IGNORE INTO form_accounts (form_id, line_account_id)
SELECT DISTINCT area.form_id, menu.account_id
FROM rich_menu_areas area
JOIN rich_menu_pages page ON page.id = area.page_id
JOIN rich_menu_groups menu ON menu.id = page.group_id
WHERE area.form_id IS NOT NULL;

-- ウェビナー内で使う既存フォーム。
INSERT OR IGNORE INTO form_accounts (form_id, line_account_id)
SELECT DISTINCT cta.form_id, webinar.account_id
FROM webinar_ctas cta
JOIN webinars webinar ON webinar.id = cta.webinar_id
WHERE cta.form_id IS NOT NULL
  AND webinar.account_id IS NOT NULL;

-- 利用先を推定できない旧フォームは、誤ったアカウントへ割り当てない。
-- 公開URLは従来どおり維持し、管理画面では既定テナントの全体管理者だけが
-- 「管理者確認」として扱う。割り当ては確認後に別工程で行う。
