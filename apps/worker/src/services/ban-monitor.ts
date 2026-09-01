/**
 * BAN検知モニター — cronトリガーで定期実行
 *
 * LINE APIのエラー率を監視し、BAN リスクを検出する
 * 403/429 エラーのパターンを分析してリスクレベルを判定
 */

import {
  getLineAccounts,
  createAccountHealthLog,
  createNotification,
  getLatestRiskLevel,
} from '@line-crm/db';

export async function checkAccountHealth(
  db: D1Database,
): Promise<void> {
  const accounts = await getLineAccounts(db);

  for (const account of accounts) {
    if (!account.is_active) continue;

    try {
      await checkSingleAccount(db, account);
    } catch (err) {
      console.error(`ヘルスチェックエラー (account ${account.id}):`, err);
    }
  }
}

async function checkSingleAccount(
  db: D1Database,
  account: { id: string; channel_access_token: string },
): Promise<void> {
  const jstMs = Date.now() + 9 * 60 * 60_000;
  const now = new Date(jstMs);
  const checkPeriod = now.toISOString().slice(0, -1) + '+09:00';

  // 直近1時間のメッセージログからエラーパターンを推定
  // (実際のLINE APIエラーはログに残らないが、送信成功率から推定)
  const oneHourAgo = new Date(jstMs - 60 * 60_000).toISOString().slice(0, -1) + '+09:00';

  const sentMessages = await db
    .prepare(
      `SELECT COUNT(*) as count FROM messages_log
       WHERE direction = 'outgoing' AND created_at >= ? AND line_account_id = ?`,
    )
    .bind(oneHourAgo, account.id)
    .first<{ count: number }>();

  const totalSent = sentMessages?.count ?? 0;

  // LINE APIにヘルスチェックリクエスト
  let errorCode: number | null = null;
  let errorCount = 0;

  try {
    const response = await fetch('https://api.line.me/v2/bot/info', {
      headers: { Authorization: `Bearer ${account.channel_access_token}` },
    });

    if (!response.ok) {
      errorCode = response.status;
      errorCount = 1;
    }
  } catch {
    errorCode = 0; // ネットワークエラー
    errorCount = 1;
  }

  // リスクレベル判定
  let riskLevel = 'normal';
  if (errorCode === 403) {
    riskLevel = 'danger'; // BAN の可能性
  } else if (errorCode === 429) {
    riskLevel = 'warning'; // レート制限
  } else if (totalSent > 5000) {
    riskLevel = 'warning'; // 大量送信の警告
  }

  const previousRiskLevel = await getLatestRiskLevel(db, account.id);
  const healthLog = await createAccountHealthLog(db, {
    lineAccountId: account.id,
    errorCode: errorCode ?? undefined,
    errorCount,
    checkPeriod,
    riskLevel,
  });

  // 定期確認のたびに同じ通知を増やさず、状態が変わった時だけ知らせる。
  if (riskLevel !== previousRiskLevel) {
    if (riskLevel === 'warning' || riskLevel === 'danger') {
      await createNotification(db, {
        eventType: `account_health_${riskLevel}`,
        title: riskLevel === 'danger'
          ? 'LINE公式アカウントの接続を確認してください'
          : 'LINE公式アカウントの送信状況を確認してください',
        body: riskLevel === 'danger'
          ? 'LINEとの接続に問題が見つかりました。運用状態から確認してください。'
          : '送信量またはLINEの応答に注意が必要です。運用状態から確認してください。',
        channel: 'dashboard',
        lineAccountId: account.id,
        category: 'error',
        metadata: JSON.stringify({
          healthLogId: healthLog.id,
          riskLevel,
          errorCode,
        }),
      });
    } else if (riskLevel === 'normal' && (previousRiskLevel === 'warning' || previousRiskLevel === 'danger')) {
      await createNotification(db, {
        eventType: 'account_health_recovered',
        title: 'LINE公式アカウントの接続が正常に戻りました',
        body: '接続と送信状況が正常に戻りました。',
        channel: 'dashboard',
        lineAccountId: account.id,
        category: 'update',
        metadata: JSON.stringify({
          healthLogId: healthLog.id,
          previousRiskLevel,
        }),
      });
    }
  }

  if (riskLevel === 'danger') {
    console.error(`⚠️ BAN検知: アカウント ${account.id} で403エラー発生。即座に確認が必要。`);
  }
}
