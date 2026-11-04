/** Keep other tenants' banner records without retaining the deleted owner's image. */
export async function preserveForeignBanners(db: D1Database, tenantId: string, mediaIds: string[]): Promise<void> {
  if (!mediaIds.length) return;
  const ids = JSON.stringify(mediaIds);
  // Each banner gets its own placeholder, so tenants never share a replacement.
  // The key is a marker only: no object is uploaded and no original key is retained.
  await db.batch([
    db.prepare(`INSERT INTO media(id,kind,filename,mime_type,size_bytes,r2_key,line_account_id)
      SELECT 'missing-banner:' || lower(hex(randomblob(16))), 'image', '画像がありません', 'image/png', 0,
             'missing-banner/' || hex(b.id), NULL
        FROM banner_images b WHERE b.tenant_id<>? AND b.media_id IN (SELECT value FROM json_each(?))`).bind(tenantId,ids),
    db.prepare(`INSERT INTO media(id,kind,filename,mime_type,size_bytes,r2_key,line_account_id)
      SELECT 'missing-banner:' || lower(hex(randomblob(16))), 'image', '画像がありません', 'image/png', 0,
             'missing-banner-delivery/' || hex(d.id), d.line_account_id
        FROM banner_image_deliveries d JOIN line_accounts a ON a.id=d.line_account_id
        JOIN banner_images b ON b.id=d.banner_image_id
       WHERE a.tenant_id<>? AND b.tenant_id<>? AND d.media_id IN (SELECT value FROM json_each(?))`).bind(tenantId,tenantId,ids),
    db.prepare(`UPDATE banner_image_deliveries SET media_id=(SELECT m.id FROM media m
      WHERE m.r2_key='missing-banner-delivery/' || hex(banner_image_deliveries.id))
      WHERE media_id IN (SELECT value FROM json_each(?)) AND banner_image_id IN
        (SELECT id FROM banner_images WHERE tenant_id<>?) AND line_account_id IN
        (SELECT id FROM line_accounts WHERE tenant_id<>?)`).bind(ids,tenantId,tenantId),
    db.prepare(`UPDATE banner_images SET media_id=(SELECT m.id FROM media m WHERE m.r2_key='missing-banner/' || hex(banner_images.id))
      WHERE tenant_id<>? AND media_id IN (SELECT value FROM json_each(?))`).bind(tenantId,ids),
  ]);
}
