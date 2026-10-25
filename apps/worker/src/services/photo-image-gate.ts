/** 現在の派生画像は提出の主キーで解決する。名前付きの過去ファイルは、対応の移行まで URL 照会を保つ。 */
export async function photoImageScanAllowed(db: D1Database, key: string): Promise<boolean> {
  const indexed=await db.prepare(`SELECT ps.id FROM nen_photo_submissions ps
    JOIN media_file_scans scan ON scan.subject_kind='photo' AND scan.subject_id=ps.id
      AND scan.line_account_id=ps.line_account_id AND scan.status='clean'
    WHERE ps.review_r2_key=? OR ps.public_r2_key=?`).bind(key,key).first();
  if(indexed)return true;
  const suffix = `/images/${key}`;
  const id = /^nen-photo-(?:review|public)\/[^/]+\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:-v\d+)?\.[a-z]+$/i.exec(key)?.[1];
  if (id) {
    const photo = await db.prepare(`SELECT ps.review_image_url,ps.public_image_url,
      EXISTS(SELECT 1 FROM media_file_scans scan WHERE scan.subject_kind='photo'
        AND scan.subject_id=ps.id AND scan.line_account_id=ps.line_account_id AND scan.status='clean') AS clean
      FROM nen_photo_submissions ps WHERE ps.id=?`).bind(id).first<{
      review_image_url:string|null;public_image_url:string|null;clean:number;
    }>();
    if (photo) return photo.clean === 1 && [photo.review_image_url,photo.public_image_url].some(url=>url?.endsWith(suffix));
  }
  return !!await db.prepare(`SELECT ps.id FROM nen_photo_submissions ps
    JOIN media_file_scans scan ON scan.subject_kind='photo' AND scan.subject_id=ps.id
      AND scan.line_account_id=ps.line_account_id AND scan.status='clean'
    WHERE substr(ps.review_image_url,-length(?))=? OR substr(ps.public_image_url,-length(?))=?`)
    .bind(suffix,suffix,suffix,suffix).first();
}
