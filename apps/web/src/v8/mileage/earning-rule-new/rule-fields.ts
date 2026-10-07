/**
 * たまる決めごとの画面で共有する選択肢と文言（`new` と `edit`）。
 *
 * きっかけ。実際に awardActivityMileage / enqueueMileageEvent が呼ばれている
 * 行動だけを並べる（N-238: 届かない出来事を選べる見せかけにしない）。
 * source を指定すると、その経路から来たものだけが対象になる。
 */
export const EARNING_RULE_EVENT_TYPES = [
  {
    value: 'message_received',
    label: 'メッセージを受け取った',
    note: '友だちからトークが届いたとき',
    sources: [
      ['', 'すべて'],
      ['line', 'LINEのトーク'],
    ],
  },
  {
    value: 'link_clicked',
    label: 'リンクがクリックされた',
    note: '計測リンクを開いたとき',
    sources: [
      ['', 'すべて'],
      ['tracked_link', '計測リンク'],
    ],
  },
  {
    value: 'form_submitted',
    label: 'フォームが送信された',
    note: '回答が届いたとき',
    sources: [
      ['', 'すべて'],
      ['form', 'フォーム'],
    ],
  },
  {
    value: 'booking_created',
    label: '予約が入った',
    note: '予約が作られたとき',
    sources: [
      ['', 'すべて'],
      ['booking', '予約'],
      ['event_booking', 'イベント予約'],
    ],
  },
  {
    value: 'friend_registered',
    label: '友だちが増えた',
    note: '友だち追加されたとき。紹介経由なら、受け取る人で紹介した人を選べます',
    sources: [
      ['', 'すべて'],
      ['line_relationship', 'LINEの友だち追加'],
    ],
  },
  {
    value: 'friend_following_7d',
    label: '7日つづけてフォローしてくれた',
    note: 'フォローが7日つづいたとき',
    sources: [
      ['', 'すべて'],
      ['line_relationship', 'LINEの友だち関係'],
    ],
  },
  {
    value: 'friend_following_30d',
    label: '30日つづけてフォローしてくれた',
    note: 'フォローが30日つづいたとき',
    sources: [
      ['', 'すべて'],
      ['line_relationship', 'LINEの友だち関係'],
    ],
  },
  {
    value: 'friend_following_90d',
    label: '90日つづけてフォローしてくれた',
    note: 'フォローが90日つづいたとき',
    sources: [
      ['', 'すべて'],
      ['line_relationship', 'LINEの友だち関係'],
    ],
  },
  {
    value: 'friend_following_180d',
    label: '180日つづけてフォローしてくれた',
    note: 'フォローが180日つづいたとき',
    sources: [
      ['', 'すべて'],
      ['line_relationship', 'LINEの友だち関係'],
    ],
  },
  {
    value: 'friend_following_365d',
    label: '1年つづけてフォローしてくれた',
    note: 'フォローが1年つづいたとき',
    sources: [
      ['', 'すべて'],
      ['line_relationship', 'LINEの友だち関係'],
    ],
  },
  {
    value: 'webinar_watch_5m',
    label: 'ウェビナーを5分見た',
    note: '再生位置が5分を超えたとき',
    sources: [
      ['', 'すべて'],
      ['webinar', 'ウェビナー'],
    ],
  },
  {
    value: 'webinar_watch_15m',
    label: 'ウェビナーを15分見た',
    note: '再生位置が15分を超えたとき',
    sources: [
      ['', 'すべて'],
      ['webinar', 'ウェビナー'],
    ],
  },
  {
    value: 'webinar_completed',
    label: 'ウェビナーを見終えた',
    note: '9割まで見たとき',
    sources: [
      ['', 'すべて'],
      ['webinar', 'ウェビナー'],
    ],
  },
  {
    value: 'webinar_cta_clicked',
    label: 'ウェビナーのボタンが押された',
    note: '案内のリンクを開いたとき',
    sources: [
      ['', 'すべて'],
      ['webinar', 'ウェビナー'],
    ],
  },
  {
    value: 'purchase_completed',
    label: '購入した',
    note: '決済が通ったとき',
    sources: [
      ['', 'すべて'],
      ['stripe', 'Stripe'],
    ],
  },
  {
    value: 'instagram_line_returned',
    label: 'Instagramから戻ってきた',
    note: 'Instagram経由でLINEに戻ったとき',
    sources: [
      ['', 'すべて'],
      ['instagram', 'Instagram'],
    ],
  },
  {
    value: 'instagram_dm_received',
    label: 'InstagramのDMが届いた',
    note: 'Instagram連携からDMが届いたとき',
    sources: [
      ['', 'すべて'],
      ['instagram', 'Instagram'],
    ],
  },
  {
    value: 'instagram_comment_created',
    label: 'Instagramにコメントされた',
    note: '投稿にコメントが付いたとき',
    sources: [
      ['', 'すべて'],
      ['instagram', 'Instagram'],
    ],
  },
  {
    value: 'instagram_story_mentioned',
    label: 'Instagramのストーリーで言及された',
    note: 'ストーリーでメンションされたとき',
    sources: [
      ['', 'すべて'],
      ['instagram', 'Instagram'],
    ],
  },
  {
    value: 'tag_added',
    label: 'タグが付いた',
    note: '担当者や自動処理でタグが付いたとき',
    sources: [
      ['', 'すべて'],
      ['tag', 'タグ'],
    ],
  },
  {
    value: 'affiliate_conversion_approved',
    label: '紹介の成果が承認された',
    note: '紹介の成果を管理者が承認したとき。行動した人は紹介者です',
    sources: [
      ['', 'すべて'],
      ['affiliate_conversion', '紹介成果'],
    ],
  },
] as const

/** 付与の自動通知の既定文。編集画面は既存の下書きの文を優先して残す。 */
export const EARNING_RULE_NOTIFY_TEMPLATE =
  'ありがとうございます。{awardedMiles} マイルが付きました。現在の残高は {balance} マイルです。'

/** 取り消しを追跡できるきっかけは、対になる取消イベントを返す。 */
export function earningRuleCancellationEvent(eventType: string): string | null {
  if (eventType === 'booking_created') return 'booking_cancelled'
  if (eventType === 'purchase_completed') return 'order_cancelled'
  return null
}
