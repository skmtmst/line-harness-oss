import { recordMediaUsage, pruneStaleMediaUsages, type MediaRefKind } from '@line-crm/db';

/**
 * メディアの使用箇所を数え直す。
 *
 * 画像を消す前に「5か所で使われています」と出すための表を作る。
 * 本文の中にURLが文字として埋まっているだけなので、走査するしかない。
 *
 * 走査した時点の情報でしかない。それでも「何も分からないまま消す」より
 * はるかにましだ、という判断で入れている。画面にもその旨を書いてある。
 */

/** どのテーブルの、どの列を見るか。 */
const SOURCES: Array<{ refKind: MediaRefKind; table: string; idColumn: string; columns: string[] }> = [
  { refKind: 'template', table: 'templates', idColumn: 'id', columns: ['message_content'] },
  { refKind: 'broadcast', table: 'broadcasts', idColumn: 'id', columns: ['message_content'] },
  // 旧 rich_menus 表は存在しない。LINEへ送る実画像はページのR2キーで持つ。
  { refKind: 'rich_menu', table: 'rich_menu_pages', idColumn: 'id', columns: ['image_r2_key'] },
  {
    refKind: 'scenario_step',
    table: 'scenario_steps',
    idColumn: 'id',
    columns: ['message_content'],
  },
  { refKind: 'nen_column', table: 'nen_columns', idColumn: 'id', columns: ['body'] },
  { refKind: 'event', table: 'events', idColumn: 'id', columns: ['image_url', 'og_image_url'] },
  { refKind: 'webinar', table: 'webinars', idColumn: 'id', columns: ['thumbnail_url'] },
];

export interface ScanResult {
  scanned: number;
  matched: number;
  pruned: number;
}

/**
 * R2のキーで探す。
 *
 * URLではなくキー（media/xxxx.png）で探すのは、同じファイルが
 * 違うドメインのURLで書かれていることがあるため。キーは1つしかない。
 */
export async function scanMediaUsage(
  db: D1Database,
  now: string,
  opts: { limit?: number } = {},
): Promise<ScanResult> {
  const media = await db
    .prepare(`SELECT id, r2_key FROM media ORDER BY created_at DESC LIMIT ?`)
    .bind(opts.limit ?? 500)
    .all<{ id: string; r2_key: string }>();

  let matched = 0;
  for (const item of media.results) {
    for (const source of SOURCES) {
      const conditions = source.columns.map((col) => `${col} LIKE ?`).join(' OR ');
      const binds = source.columns.map(() => `%${item.r2_key}%`);
      let rows;
      try {
        rows = await db
          .prepare(
            `SELECT ${source.idColumn} AS ref_id FROM ${source.table} WHERE ${conditions} LIMIT 200`,
          )
          .bind(...binds)
          .all<{ ref_id: string }>();
      } catch (err) {
        // 表や列が無い環境もある（機能を使っていない場合）。
        // 1つ欠けたせいで走査全体が止まる方が困る。
        console.error(`media usage scan skipped ${source.table}:`, err);
        continue;
      }
      for (const row of rows.results) {
        await recordMediaUsage(db, {
          mediaId: item.id,
          refKind: source.refKind,
          refId: row.ref_id,
        });
        matched++;
      }
    }
  }

  // 今回の走査で触らなかった記録を落とす。本文から画像が外されたとき、
  // 記録だけが残ると「使われている」と言い続けることになる。
  //
  // 対象は今回走査したメディアだけ。上限で外れたものまで消すと、
  // それらが「どこでも使われていない」ことになり、削除前の警告が効かなくなる。
  const pruned = await pruneStaleMediaUsages(
    db,
    now,
    media.results.map((m) => m.id),
  );

  return { scanned: media.results.length, matched, pruned };
}
