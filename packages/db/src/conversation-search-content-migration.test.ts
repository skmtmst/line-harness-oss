import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { it, expect } from 'vitest';
it('607は既存本文を残し、編集・取消・テスト切替で検索用の本文を消す',()=>{
  const db=new Database(':memory:');
  try {
    db.exec("CREATE TABLE messages_log(id TEXT PRIMARY KEY,friend_id TEXT,content TEXT,line_event_at TEXT,created_at TEXT,delivery_type TEXT,unsent_at TEXT); INSERT INTO messages_log(id,friend_id,content,created_at) VALUES('m','f','ＬＩＮＥ','2026-10-07')");
    db.exec(readFileSync(new URL('../migrations/607_conversation_search_content.sql',import.meta.url),'utf8'));
    expect(db.prepare('SELECT content,search_content FROM messages_log').get()).toEqual({content:'ＬＩＮＥ',search_content:null});
    for(const update of ["content='新しい'","unsent_at='2026-10-07'","delivery_type='test'"]) {
      db.exec("UPDATE messages_log SET search_content='line'");
      db.exec('UPDATE messages_log SET '+update);
      expect(db.prepare('SELECT search_content FROM messages_log').get()).toEqual({search_content:null});
    }
  } finally {db.close();}
});
