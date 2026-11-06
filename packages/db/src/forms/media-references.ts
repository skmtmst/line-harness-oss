/** 下書きと現在公開版の使用先。統括の原子的な計画にも同じSQLを使う。 */
export function formMediaUsageQueries(formId: string): Array<{ sql: string; bindings: string[] }> {
  const contents = `SELECT f.layout FROM forms f WHERE f.id=?
    UNION ALL SELECT v.layout FROM forms f JOIN form_versions v ON v.id=f.current_published_version_id AND v.form_id=f.id WHERE f.id=?`;
  return [
    { sql: "DELETE FROM media_usages WHERE ref_kind='form' AND ref_id=?", bindings: [formId] },
    {
      // OR IGNOREはCHECK違反も隠すので使わない。未適用DBでは本文ごと戻す。
      sql: `INSERT INTO media_usages(media_id,ref_kind,ref_id)
        WITH contents AS (${contents}), references_in_form AS (
          SELECT json_extract(r.value,'$.mediaId') AS media_id FROM contents c,
            json_each(CASE WHEN json_valid(c.layout) THEN c.layout ELSE 'null' END,'$.references') r
          WHERE json_extract(r.value,'$.kind')='image'
        ), adopted AS (
          SELECT CASE WHEN m.id IS NOT NULL AND EXISTS(SELECT 1 FROM form_accounts fa WHERE fa.form_id=? AND fa.line_account_id=m.line_account_id)
            THEN m.id ELSE NULL END AS media_id FROM references_in_form r LEFT JOIN media m ON m.id=r.media_id
          UNION SELECT m.id FROM contents c JOIN form_accounts fa ON fa.form_id=?
            JOIN media m ON m.line_account_id=fa.line_account_id
          WHERE instr(c.layout,m.r2_key)>0 OR instr(c.layout,'/media/'||m.id||'/content')>0
            OR EXISTS(SELECT 1 FROM media_versions mv WHERE mv.media_id=m.id AND instr(c.layout,mv.r2_key)>0)
        ) SELECT DISTINCT media_id,'form',? FROM adopted WHERE media_id IS NOT NULL`,
      bindings: [formId, formId, formId, formId, formId],
    },
  ];
}

export function formMediaUsageStatements(db: D1Database, formId: string): D1PreparedStatement[] {
  return formMediaUsageQueries(formId).map(query => db.prepare(query.sql).bind(...query.bindings));
}
