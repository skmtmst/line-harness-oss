import { decryptCredential } from '@line-crm/db';


/**
 * つなぎ先ごとの受信鍵。ec_connectors の暗号化された鍵を復号する。
 * 鍵の用意がない・復号できないときは null（全体の鍵へ倒す）。
 */
export async function getConnectorSecret(
  db: D1Database,
  lineAccountId: string,
  encryptionKey: string | undefined,
): Promise<string | null> {
  try {
    const row = await db.prepare(
      `SELECT inbound_secret_encrypted FROM ec_connectors WHERE line_account_id = ? LIMIT 1`,
    ).bind(lineAccountId).first<{ inbound_secret_encrypted: string | null }>();
    const encrypted = row?.inbound_secret_encrypted;
    if (!encrypted) return null;
    const secret = await decryptCredential(encrypted, encryptionKey);
    return secret && secret.length >= 32 ? secret : null;
  } catch {
    return null;
  }
}
