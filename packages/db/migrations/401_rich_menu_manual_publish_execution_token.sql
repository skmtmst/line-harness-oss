-- 古いlease holderのcatchが、新しいholderの成功をfailedへ上書きしないための世代トークン。
ALTER TABLE rich_menu_manual_publish_requests
  ADD COLUMN execution_token TEXT;
