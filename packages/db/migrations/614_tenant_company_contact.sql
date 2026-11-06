-- オーナー承認 2026-10-08：統括の会社と連絡先。既存の統括は未登録のまま保つ。
ALTER TABLE tenants ADD COLUMN legal_company_name TEXT;
ALTER TABLE tenants ADD COLUMN company_postal_code TEXT;
ALTER TABLE tenants ADD COLUMN company_address TEXT;
ALTER TABLE tenants ADD COLUMN company_building TEXT;
ALTER TABLE tenants ADD COLUMN company_phone TEXT;
ALTER TABLE tenants ADD COLUMN contact_name TEXT;
ALTER TABLE tenants ADD COLUMN contact_email TEXT;
ALTER TABLE tenants ADD COLUMN invoice_addressee TEXT;
