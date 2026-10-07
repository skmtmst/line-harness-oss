-- NFKCはWorkerで一度だけ生成し、検索・件数・ページ分割はDBで行う。
ALTER TABLE messages_log ADD COLUMN search_content TEXT;
CREATE INDEX idx_messages_conversation_position ON messages_log(friend_id,COALESCE(line_event_at,created_at),id) WHERE delivery_type IS NULL OR delivery_type!='test';
CREATE INDEX idx_messages_search_pending ON messages_log(friend_id,id) WHERE search_content IS NULL AND unsent_at IS NULL AND (delivery_type IS NULL OR delivery_type!='test');
CREATE TRIGGER messages_search_invalidate AFTER UPDATE OF content,unsent_at,delivery_type ON messages_log
WHEN OLD.content IS NOT NEW.content OR OLD.unsent_at IS NOT NEW.unsent_at OR OLD.delivery_type IS NOT NEW.delivery_type
BEGIN UPDATE messages_log SET search_content=NULL WHERE id=NEW.id; END;
