-- 検証環境 nen-line-stg のみ。本番へは適用しない。
-- template_versions の過去の版を書き換えない契約の特例として、未編集の見本の
-- 単一 text 包みだけを本文へ戻す。見本以外、編集済み、別の本文、他の型は変えない。
-- 公開状態・版番号・日時・source_snapshot は保つ。旧新形式の未編集判定は Worker が扱う。
-- 先に版を直し、未編集判定に使う現在本文は最後に直す。全体を1つの移行として適用する。
WITH eligible AS (
  SELECT t.id,t.message_content
  FROM templates t
  WHERE t.message_type='text'
    AND json_type((CASE WHEN json_valid(t.message_content) THEN t.message_content ELSE 'null' END))='object' AND json_type((CASE WHEN json_valid(t.message_content) THEN t.message_content ELSE 'null' END),'$.text')='text' AND (SELECT COUNT(*) FROM json_each((CASE WHEN json_valid(t.message_content) THEN t.message_content ELSE 'null' END)))=1
    AND EXISTS (
      SELECT 1 FROM style_starter_items b
      WHERE b.kind='template' AND b.is_sample=1
        AND b.target_id=t.id AND b.line_account_id=t.line_account_id
        AND b.source_snapshot IS (SELECT json_object('id',id,'name',name,'content',message_content,'type',message_type,'draft',draft_message_content,'bubbles',message_bubbles_json,'draftBubbles',draft_message_bubbles_json,'updated',updated_at,'published',published_version,'draftRevision',draft_revision,'folder',folder_id,'question',question_json,'draftQuestion',draft_question_json,'carousel',carousel_actions_json,'draftCarousel',draft_carousel_actions_json) FROM templates r WHERE r.id=t.id AND r.line_account_id=t.line_account_id)
    )
)
UPDATE template_versions SET message_content=json_extract(message_content,'$.text')
WHERE message_type='text'
  AND json_type((CASE WHEN json_valid(message_content) THEN message_content ELSE 'null' END))='object' AND json_type((CASE WHEN json_valid(message_content) THEN message_content ELSE 'null' END),'$.text')='text' AND (SELECT COUNT(*) FROM json_each((CASE WHEN json_valid(message_content) THEN message_content ELSE 'null' END)))=1
  AND EXISTS (SELECT 1 FROM eligible e
    WHERE e.id=template_versions.template_id
      AND e.message_content=template_versions.message_content);

WITH eligible AS (
  SELECT t.id,t.message_content
  FROM templates t
  WHERE t.message_type='text'
    AND json_type((CASE WHEN json_valid(t.message_content) THEN t.message_content ELSE 'null' END))='object' AND json_type((CASE WHEN json_valid(t.message_content) THEN t.message_content ELSE 'null' END),'$.text')='text' AND (SELECT COUNT(*) FROM json_each((CASE WHEN json_valid(t.message_content) THEN t.message_content ELSE 'null' END)))=1
    AND EXISTS (
      SELECT 1 FROM style_starter_items b
      WHERE b.kind='template' AND b.is_sample=1
        AND b.target_id=t.id AND b.line_account_id=t.line_account_id
        AND b.source_snapshot IS (SELECT json_object('id',id,'name',name,'content',message_content,'type',message_type,'draft',draft_message_content,'bubbles',message_bubbles_json,'draftBubbles',draft_message_bubbles_json,'updated',updated_at,'published',published_version,'draftRevision',draft_revision,'folder',folder_id,'question',question_json,'draftQuestion',draft_question_json,'carousel',carousel_actions_json,'draftCarousel',draft_carousel_actions_json) FROM templates r WHERE r.id=t.id AND r.line_account_id=t.line_account_id)
    )
)
UPDATE templates SET message_content=json_extract(message_content,'$.text')
WHERE id IN (SELECT id FROM eligible);
