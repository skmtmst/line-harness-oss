-- 紹介者を統括とLINE公式アカウントの境界へ移す。
-- 既存行は、友だち・紹介リンク・案件・成果に現れるアカウントが
-- 1つに決まる場合だけ自動補完する。複数候補は推測せず NULL のまま残す。

ALTER TABLE affiliates ADD COLUMN tenant_id TEXT REFERENCES tenants(id);
ALTER TABLE affiliates ADD COLUMN line_account_id TEXT REFERENCES line_accounts(id);

UPDATE affiliates
   SET line_account_id = (
     SELECT MIN(candidate_line_account_id)
       FROM (
         SELECT f.line_account_id AS candidate_line_account_id
           FROM friends f
          WHERE f.id = affiliates.friend_id
            AND f.line_account_id IS NOT NULL
         UNION ALL
         SELECT al.line_account_id
           FROM affiliate_links al
          WHERE al.affiliate_id = affiliates.id
            AND al.line_account_id IS NOT NULL
         UNION ALL
         SELECT off.line_account_id
           FROM affiliate_links al
           JOIN affiliate_offers off ON off.id = al.offer_id
          WHERE al.affiliate_id = affiliates.id
            AND off.line_account_id IS NOT NULL
         UNION ALL
         SELECT f.line_account_id
           FROM conversion_events ce
           JOIN friends f ON f.id = ce.friend_id
          WHERE ce.affiliate_id = affiliates.id
            AND f.line_account_id IS NOT NULL
       ) candidates
     HAVING COUNT(DISTINCT candidate_line_account_id) = 1
   )
 WHERE line_account_id IS NULL;

-- 紹介者に帰属できた汎用リンクも同じアカウントへ寄せる。
UPDATE affiliate_links
   SET line_account_id = (
     SELECT a.line_account_id FROM affiliates a WHERE a.id = affiliate_links.affiliate_id
   )
 WHERE line_account_id IS NULL
   AND EXISTS (
     SELECT 1 FROM affiliates a
      WHERE a.id = affiliate_links.affiliate_id
        AND a.line_account_id IS NOT NULL
   );

-- tenant導入前の紹介者は既定統括のデータ。アカウントが決まった行は
-- line_accounts側のtenantを優先し、決まらない行も他tenantへ推測移動しない。
UPDATE affiliates
   SET tenant_id = COALESCE(
     (SELECT COALESCE(la.tenant_id, '00000000-0000-4000-8000-000000000001')
        FROM line_accounts la
       WHERE la.id = affiliates.line_account_id),
     '00000000-0000-4000-8000-000000000001'
   )
 WHERE tenant_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_affiliates_tenant_account_created
  ON affiliates(tenant_id, line_account_id, created_at DESC);
