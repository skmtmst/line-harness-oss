import { encryptCredential } from '../packages/db/src/credential-crypto.js';

type D1Row = {
  id: string;
  channel_access_token: string;
  channel_secret: string;
  channel_access_token_encrypted: string | null;
  channel_secret_encrypted: string | null;
};

type D1Result<T> = {
  success: boolean;
  result?: Array<{ success: boolean; results?: T[]; error?: string }>;
  errors?: Array<{ message?: string }>;
};

const apply = process.argv.includes('--apply');
const accountId = process.env.CF_ACCOUNT_ID?.trim();
const databaseId = process.env.D1_DATABASE_ID?.trim();
const apiToken = process.env.CF_API_TOKEN?.trim();
const encryptionKey = process.env.LINE_CREDENTIAL_ENCRYPTION_KEY?.trim();

function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(required('CF_ACCOUNT_ID', accountId))}/d1/database/${encodeURIComponent(required('D1_DATABASE_ID', databaseId))}/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${required('CF_API_TOKEN', apiToken)}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sql, params }),
    },
  );
  const body = await response.json() as D1Result<T>;
  const result = body.result?.[0];
  if (!response.ok || !body.success || !result?.success) {
    const reason = result?.error || body.errors?.[0]?.message || `HTTP ${response.status}`;
    throw new Error(`D1 query failed: ${reason}`);
  }
  return result.results ?? [];
}

async function main(): Promise<void> {
  required('LINE_CREDENTIAL_ENCRYPTION_KEY', encryptionKey);
  const rows = await query<D1Row>(
    `SELECT id, channel_access_token, channel_secret,
            channel_access_token_encrypted, channel_secret_encrypted
       FROM line_accounts
      WHERE channel_access_token_encrypted IS NULL
         OR channel_secret_encrypted IS NULL
      ORDER BY id`,
  );

  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', pendingAccounts: rows.length }));
  if (!apply || rows.length === 0) return;

  let migrated = 0;
  for (const row of rows) {
    const encryptedAccessToken = row.channel_access_token_encrypted
      ?? await encryptCredential(row.channel_access_token, encryptionKey);
    const encryptedChannelSecret = row.channel_secret_encrypted
      ?? await encryptCredential(row.channel_secret, encryptionKey);
    await query(
      `UPDATE line_accounts
          SET channel_access_token_encrypted = ?,
              channel_secret_encrypted = ?
        WHERE id = ?`,
      [encryptedAccessToken, encryptedChannelSecret, row.id],
    );
    migrated += 1;
  }
  console.log(JSON.stringify({ mode: 'apply', migratedAccounts: migrated }));
}

main().catch((error) => {
  // Never include row data, plaintext credentials, ciphertext, or key material.
  console.error(error instanceof Error ? error.message : 'Credential migration failed');
  process.exitCode = 1;
});
