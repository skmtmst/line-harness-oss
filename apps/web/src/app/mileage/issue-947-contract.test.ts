import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const SCORE_RULES = readFileSync(join(HERE, 'score-rules', 'page.tsx'), 'utf8')
const EARNING_RULES = readFileSync(join(HERE, 'earning-rules', 'new', 'page.tsx'), 'utf8')
const REWARDS_TAB = readFileSync(join(HERE, 'mileage-rewards-tab.tsx'), 'utf8')
const SCORE_TAB = readFileSync(join(HERE, 'action-score-tab.tsx'), 'utf8')
const SCORE_DIALOG = readFileSync(join(HERE, 'action-score-adjustment-dialog.tsx'), 'utf8')
const API = readFileSync(join(HERE, '..', '..', 'lib', 'api.ts'), 'utf8')

/*
 * Issue #947（N-235/N-236/N-238/N-239）の画面側の約束だけを見る。
 * 口の振る舞いは worker/db の直接試験が見ている。
 */

describe('N-239：スコアのきっかけは届く出来事だけを全部出す', () => {
  it('もともとの7件に加えて、実発火する出来事を選べる', () => {
    for (const value of [
      'message_received|line_webhook',
      'link_clicked|tracked_link',
      'form_submitted|form',
      'booking_created|',
      'purchase_completed|stripe',
      'inactivity_30d|scheduler',
      'friend_unfollow|line_webhook',
      // 追加分（N-239）。すべて発火側と1対1で対応する。
      'postback_received|line_webhook',
      'friend_add|line_webhook',
      'cv_fire|stripe',
      'staff_assigned|inbox_assignment',
      'manual_reply_sent|manual_reply',
    ]) {
      expect(SCORE_RULES).toContain(`value: '${value}'`)
    }
  })

  it('EC連携の出来事は共有の正本から発生元 eccube で出す', () => {
    expect(SCORE_RULES).toContain("from '@line-crm/shared'")
    expect(SCORE_RULES).toContain('EC_EVENT_TYPES.map')
    expect(SCORE_RULES).toContain('|eccube')
  })

  it('スコアへ届かない出来事は選択肢に出さない', () => {
    // tag_added は sourceKind/sourceEventId が無くスコア適用を素通りする。
    // 継続フォロー・ウェビナー視聴・紹介成果はマイル専用の出来事。
    for (const absent of [
      'tag_added|',
      'webinar_watch_5m|',
      'webinar_completed|',
      'friend_following_7d|',
      'affiliate_conversion_approved|',
      'message_opened|',
    ]) {
      expect(SCORE_RULES).not.toContain(`value: '${absent}`)
    }
    expect(SCORE_RULES).toContain('マイル専用のきっかけは出しません')
  })
})

describe('N-238：マイルのきっかけは実配線済みの出来事だけを全部出す', () => {
  it('紹介・継続・途中視聴・タグ・Instagramの出来事を選べる', () => {
    for (const value of [
      'friend_following_7d',
      'friend_following_30d',
      'friend_following_90d',
      'friend_following_180d',
      'friend_following_365d',
      'webinar_watch_5m',
      'webinar_watch_15m',
      'tag_added',
      'instagram_dm_received',
      'instagram_comment_created',
      'instagram_story_mentioned',
      'affiliate_conversion_approved',
    ]) {
      expect(EARNING_RULES).toContain(`value: '${value}'`)
    }
  })

  it('発生元は実際の発火側とそろえる', () => {
    expect(EARNING_RULES).toContain(`['line_relationship', 'LINEの友だち関係']`)
    expect(EARNING_RULES).toContain(`['webinar', 'ウェビナー']`)
    expect(EARNING_RULES).toContain(`['tag', 'タグ']`)
    expect(EARNING_RULES).toContain(`['instagram', 'Instagram']`)
    expect(EARNING_RULES).toContain(`['affiliate_conversion', '紹介成果']`)
    expect(EARNING_RULES).toContain(`['line', 'LINEのトーク']`)
  })

  it('選べないきっかけを「準備中」として出さない', () => {
    expect(EARNING_RULES).not.toContain('「タグが付いた」は、まだきっかけに選べません')
    expect(EARNING_RULES).not.toContain('準備中')
  })
})

describe('N-236：止めた使い道は一覧からまた出せる', () => {
  it('stopped の行にも操作ボタンを出し、archived には出さない', () => {
    expect(REWARDS_TAB).toContain("reward.status === 'stopped'")
    expect(REWARDS_TAB).toContain('また出す')
    expect(REWARDS_TAB).not.toContain("reward.status === 'archived' ? (")
  })

  it('復帰は既存の状態変更口を使い、削除・作り直しはしない', () => {
    expect(REWARDS_TAB).toContain('api.mileage.resumeReward')
    expect(API).toContain('resumeReward')
    expect(API).toMatch(/resumeReward[\s\S]*?status: 'published'/)
  })
})

describe('N-235：点数の手動調整と帯の試算', () => {
  it('一覧の各行から権限つきで調整ダイアログを開く', () => {
    expect(SCORE_TAB).toContain('点数を直す')
    expect(SCORE_TAB).toContain('ActionScoreAdjustmentDialog')
    expect(SCORE_TAB).toContain("response.data.role === 'owner' || response.data.role === 'admin'")
    expect(SCORE_TAB).toContain('canAdjust ? <Button')
  })

  it('調整は確認段・理由必須・冪等キーを備える', () => {
    expect(SCORE_DIALOG).toContain("api.actionScores.adjust")
    expect(SCORE_DIALOG).toContain('idempotencyKey.current')
    expect(SCORE_DIALOG).toContain('理由を入力してください')
    expect(SCORE_DIALOG).toContain('crypto.randomUUID()')
    expect(SCORE_DIALOG).toContain('既存の履歴は書き換えず')
    expect(API).toContain("'X-Confirm-Irreversible': 'action-score-adjustment'")
    expect(API).toContain("'Idempotency-Key': idempotencyKey")
    expect(API).toContain('/api/action-scores/adjustments')
  })

  it('帯の試算は読み取り専用で、編集したら古い結果を捨てる', () => {
    expect(SCORE_RULES).toContain('api.actionScores.previewBands')
    expect(SCORE_RULES).toContain('この分けかただと何人入るか見る')
    expect(SCORE_RULES).toContain('setBandPreview(null)')
    expect(SCORE_RULES).toContain('点数は変わりません')
    expect(API).toContain('/api/action-scores/bands/preview')
  })
})
