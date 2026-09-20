import type { FeatureKey } from './feature-settings'

/**
 * サイドメニューの項目。**ここが正本。**
 *
 * サイドバーと機能設定で別々に項目を持っていた頃は、機能設定に載っていない
 * 項目（友だち追加時の配信・コンテンツ・分析・自動化・予約）があり、
 * それらはオン／オフを切り替える手段が無かった。逆に機能設定にしか無い項目
 * （多店舗管理）もあり、切り替えてもメニューに出ない項目が並んでいた。
 * 1か所に置いて、両方がこれを読む。
 */
export interface MenuItem {
  /** 並び順を保存するときの目印。href とは別に持つ（URLを変えても順序が残る） */
  id: string
  href: string
  label: string
  /** 24x24 の path。lucide 相当の形を手で写している。 */
  icon: string
  /** 出す数の種類（仕様 §5）。無ければバッジを出さない。 */
  badge?: 'unanswered' | 'photos' | 'unmatched' | 'operations'
  /** 機能設定に出す一行説明。 */
  note: string
  /**
   * オン／オフに使うキー。無い項目は常に出す。
   *
   * 同じキーを2つの項目に付けてよい（予約管理と予約設定など）。片方だけ
   * 隠せる作りにすると、予約を切ったのに予約設定だけ残る。
   */
  featureKey?: FeatureKey
  /** 消せない項目。機能設定では鍵付きで出し、スイッチを触れなくする。 */
  required?: boolean
  /**
   * href と違う permission key で出し分けたいときに使う（N-411）。
   * 例: 本人の勤務は href が '/booking/staff/shifts' だが鍵は 'booking.staff.own'。
   */
  permissionKey?: string
  /** true のとき owner/admin には出さない（staff の本人向け項目）。 */
  staffOnly?: boolean
  /** 赤で出す項目。 */
  danger?: boolean
}

export interface MenuSection {
  /** 並び順を保存するときの目印。 */
  id: string
  /** サイドバーに出す見出し。null は見出しを付けない。 */
  label: string | null
  /** 機能設定に出す見出し。サイドバーで見出しを付けない区分にも名前が要る。 */
  title: string
  items: MenuItem[]
}

/** 統括コンソールだけで使う、アカウント横断の管理メニュー。 */
export const HQ_MENU_SECTIONS: MenuSection[] = [
  {
    id: 'hq',
    label: null,
    title: '統括',
    items: [
      { href: '/hq', label: 'アカウント', icon: 'M3 21h18M5 21V7l7-4 7 4v14M9 10h2m2 0h2m-6 4h2m2 0h2m-6 4h2m2 0h2', id: 'hq-stores', note: '統括に属するLINE公式アカウントを管理します', required: true },
      { href: '/hq/friend-attributes', label: '友だち属性', icon: 'M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z', id: 'hq-tags', note: 'タグのひな形を作成し、アカウントへ配布します', required: true },
      { href: '/hq/templates', label: 'テンプレート', icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z', id: 'hq-templates', note: 'メッセージのひな形を作成し、アカウントへ配布します', required: true },
      { href: '/hq/rich-menus', label: 'リッチメニュー', icon: 'M4 4h6v6H4V4zm0 10h6v6H4v-6zm10-10h6v6h-6V4zm0 10h6v6h-6v-6z', id: 'hq-rich-menus', note: 'リッチメニューのひな形を作成し、アカウントへ配布します', required: true },
      { href: '/hq/form-submissions', label: '回答フォーム', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2', id: 'hq-forms', note: '回答フォームのひな形を作成し、アカウントへ配布します', required: true },
      { href: '/hq/banners', label: 'バナー生成', icon: 'M4 5a2 2 0 012-2h12a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm4 5a1.5 1.5 0 100-3 1.5 1.5 0 000 3zm12 5l-5-5L5 21', id: 'hq-banners', note: '配信やリッチメニューに使う画像をAIで作り、アカウントへ渡します', required: true },
    ],
  },
]

export const MENU_SECTIONS: MenuSection[] = [
  {
    id: 'basic',
    label: 'メイン',
    title: 'メイン',
    items: [
      { href: '/', label: 'ダッシュボード', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6' , id: 'dashboard', note: '数字と、今日やることのまとめ', required: true },
      { href: '/chats', label: '受信箱', icon: 'M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5', badge: 'unanswered' , id: 'inbox', note: 'LINEとメールの問い合わせをまとめて扱います', required: true },
      { href: '/friends', label: '友だち', icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z' , id: 'friends', note: '友だちの検索・タグ付け・対応状況', required: true },
      { href: '/tags', label: '友だち属性', icon: 'M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z' , id: 'friend-attributes', note: 'タグ・友だち情報欄・保存した検索・対応マーク', required: true },
    ],
  },
  {
    id: 'delivery',
    label: '配信',
    title: '配信',
    items: [
      { href: '/scenarios', label: 'シナリオ配信', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01' , id: 'scenarios', note: 'タイミングを指定した順次配信と分岐', featureKey: 'scenarios' },
      { href: '/broadcasts', label: '一斉配信', icon: 'M12 19l9 2-9-18-9 18 9-2zm0 0v-8' , id: 'broadcasts', note: '条件を指定した友だちへのまとめ送信', featureKey: 'broadcasts' },
      { href: '/reminders', label: 'リマインダ', icon: 'M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9' , id: 'reminders', note: '日付を起点にした事前・事後の配信', featureKey: 'reminders' },
      { href: '/auto-replies', label: '自動応答', icon: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z' , id: 'auto-replies', note: '受信メッセージへの自動返信', featureKey: 'auto_replies' },
      { href: '/friend-add-settings', label: '友だち追加時の配信', icon: 'M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z' , id: 'friend-add-settings', note: '友だち追加のきっかけごとに、流すシナリオを分けます', featureKey: 'friend_add_routing' },
      { href: '/webinars', label: 'ウェビナー', icon: 'M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z' , id: 'webinars', note: '動画セミナーの申込と視聴管理', featureKey: 'webinars' },
    ],
  },
  {
    /*
     * 作って置いておくもの。テンプレート・リッチメニュー・回答フォームは
     * 配信そのものではなく、配信や画面から呼ばれる材料なのでここに集める。
     * 以前はテンプレートとリッチメニューが「配信」、回答フォームが
     * 「成果と分析」にあり、同じ性格のものが3か所に散っていた。
     */
    id: 'contents',
    label: 'コンテンツ',
    title: 'コンテンツ',
    items: [
      { href: '/templates', label: 'テンプレート', icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' , id: 'templates', note: '差し込み変数付きの文面', featureKey: 'templates' },
      { href: '/rich-menus', label: 'リッチメニュー', icon: 'M4 4h6v6H4V4zm0 10h6v6H4v-6zm10-10h6v6h-6V4zm0 10h6v6h-6v-6z' , id: 'rich-menus', note: 'トーク下部のメニューと出し分け', featureKey: 'rich_menus' },
      { href: '/form-submissions', label: '回答フォーム', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2' , id: 'forms', note: 'フォームの作成と、友だち情報欄への記録', featureKey: 'forms' },
      { href: '/contents/vars', label: '共通情報', icon: 'M4 7V4h16v3M9 20h6M12 4v16' , id: 'common-vars', note: '会社名・営業時間など、アカウント内で共通に使う文字。テンプレートに差し込める', featureKey: 'common_vars' },
      { href: '/contents', label: '登録メディア一覧', icon: 'M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z' , id: 'contents', note: '配信で使う画像・動画・ファイルの置き場', featureKey: 'media' },
    ],
  },
  {
    id: 'results',
    label: '成果と分析',
    title: '成果と分析',
    items: [
      { href: '/conversions?tab=affiliates', label: '成果とアフィリエイト', icon: 'M12 8v13m0-13V6a2 2 0 112 2h-2zm0 0V5.5A2.5 2.5 0 109.5 8H12zm-7 4h14M5 12a2 2 0 110-4h14a2 2 0 110 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7' , id: 'affiliates', note: '紹介者・案件・成果承認を管理します', featureKey: 'affiliates' },
      { href: '/mileage', label: 'マイル', icon: 'M12 8v13m0-13V6a2 2 0 112 2h-2zm0 0V5.5A2.5 2.5 0 109.5 8H12zm-7 4h14M5 12a2 2 0 110-4h14a2 2 0 110 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7' , id: 'mileage', note: '購入・紹介でたまるポイント', featureKey: 'mileage' },
      { href: '/inflow-links', label: '流入と計測', icon: 'M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1' , id: 'inflow', note: 'URLごとのクリックと友だち追加の計測', featureKey: 'inflow_tracking' },
      { href: '/conversions', label: 'コンバージョン', icon: 'M9 11l3 3L22 4M21 4h-7M21 4v7M5 3H4a2 2 0 00-2 2v15a2 2 0 002 2h15a2 2 0 002-2v-1' , id: 'conversions', note: '成果地点（CV）と集計レポートを管理します', featureKey: 'affiliates' },
      { href: '/analytics', label: '分析', icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' , id: 'analytics', note: '友だちの増減・配信の反応をまとめて見ます', featureKey: 'analytics' },
    ],
  },
  {
    id: 'automation',
    label: '自動化',
    title: '自動化',
    items: [
      { href: '/automations', label: 'オートメーション', icon: 'M13 10V3L4 14h7v7l9-11h-7z' , id: 'automations', note: 'きっかけと動作を組み合わせた自動処理', featureKey: 'automations' },
      { href: '/webhooks', label: '外部連携', icon: 'M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z' , id: 'webhooks', note: '外部サービスとのやり取り（Webhook）', featureKey: 'external_integrations' },
    ],
  },
  {
    id: 'booking',
    label: '予約',
    title: '予約',
    items: [
      { href: '/booking/bookings', label: '予約管理', icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z' , id: 'booking-bookings', note: '入った予約の確認と変更', featureKey: 'booking' },
      { href: '/booking/menus', label: '予約設定', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z' , id: 'booking-menus', note: '予約メニュー・受付枠・休業日', featureKey: 'booking' },
      { href: '/events', label: 'イベント予約', icon: 'M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2H7a2 2 0 00-2 2v2m5-7v3m4-3v3' , id: 'events', note: '日時と定員を決めた申込の受付', featureKey: 'events' },
      // N-411 本人勤務: 予約スタッフと紐づいたログインユーザーだけの入口。
      // owner/admin は担当スタッフ一覧から開くため出さない。
      { href: '/booking/staff/shifts', label: '自分の勤務', icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z', id: 'booking-own-shifts', note: '自分のシフト・休憩・外部カレンダー連携', featureKey: 'booking', permissionKey: 'booking.staff.own', staffOnly: true },
    ],
  },
  {
    id: 'specialized',
    label: '専用機能',
    title: '専用機能',
    items: [
      // ★V6 37-1。会員（ランク・ライフタイム・マイル）。写真審査は「投稿」に改名（2026-09-16、Masato の決定）。
      { href: '/nen/members', label: '会員', icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z', id: 'nen-members', note: '会員ランク（通年・ライフタイム）とマイルの一覧・設定', featureKey: 'ec_commerce' },
      // ★V6 37-3／37-4（2026-09-16 採用）。ペットの正本は LINE 側（お客様がマイページで登録）。
      { href: '/nen/pets', label: 'マイペット', icon: 'M12 21c-4.97 0-9-3.582-9-8 0-2.5 1.5-4 3-4 1 0 1.5.5 2 1 .5-1.5 2-2.5 4-2.5s3.5 1 4 2.5c.5-.5 1-1 2-1 1.5 0 3 1.5 3 4 0 4.418-4.03 8-9 8z M8 5a1.5 1.5 0 100 3 1.5 1.5 0 000-3z M16 5a1.5 1.5 0 100 3 1.5 1.5 0 000-3z', id: 'nen-pets', note: 'お客様が登録したペットの一覧と「今日の目安」。主食のカロリー表もここ', featureKey: 'photo_review' },
      { href: '/nen/health', label: '健康日記', icon: 'M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z M9 12h2l1-2 1.5 4 1-2H16', id: 'nen-health', note: 'お客様が付けた健康日記から、気になる変化と「30日のまとめ」を見る', featureKey: 'photo_review' },
      // /health は「BAN検知ダッシュボード」で写真審査ではない。写真審査の画面は
      // /nen-members。§3-1 が BAN検知を「運用状態」へ統合すると書いているので
      // そちらに合わせた。仕様書 §2 もこのルートに直してある（2026-08-18）。
      { href: '/nen-members', label: '投稿', icon: 'M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z M15 13a3 3 0 11-6 0 3 3 0 016 0z', badge: 'photos' , id: 'photo-review', note: 'お客様が投稿した写真を確認・承認します', featureKey: 'photo_review' },
      { href: '/nen-campaigns', label: 'NEN配信', icon: 'M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z' , id: 'nen-campaigns', note: '購入後のご案内・コラム・誕生日クーポンを管理します', featureKey: 'nen_campaigns' },
    ],
  },
  {
    id: 'settings',
    label: '設定',
    title: '設定',
    items: [
      { href: '/getting-started', label: 'はじめの設定', icon: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z', id: 'getting-started', note: '最初にやることの順路と、いまどこまで終わったか', required: true },
      // 「設定」区分の先頭。要件 `v6-33-account-settings` §5-3。
      // **統括の店舗管理（/hq）とは別のもの。** こちらは送受信に使う
      // LINE公式アカウントそのものの設定。
      { href: '/accounts', label: 'LINEアカウント', icon: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.86 9.86 0 01-4-.8L3 21l1.9-3.8A7.9 7.9 0 013 12c0-4.418 4.03-8 9-8s9 3.582 9 8z' , id: 'line-accounts', note: '送受信に使うLINE公式アカウントと接続の状態', required: true },
      // 複数のLINEアカウントを「店舗のまとまり」へ振り分ける層。multi_store_hierarchy の受け口。
      { href: '/pools', label: 'プール管理', icon: 'M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10' , id: 'pools', note: '複数のLINEアカウントを店舗のまとまりとして管理します', featureKey: 'multi_store_hierarchy' },
      { href: '/staff', label: 'ログインユーザー', icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z' , id: 'staff', note: '管理画面に入る人と、その権限', required: true },
      { href: '/settings', label: '機能設定', icon: 'M4 6h16M4 12h16M4 18h7' , id: 'settings', note: 'この画面。項目の表示と並びを決めます', required: true },
      { href: '/emergency', label: '運用状態', icon: 'M13 10V3L4 14h7v7l9-11h-7z', badge: 'operations' , id: 'emergency', note: '配信の停止・再開と、異常の記録', required: true },
      // EC連携・LINE通知は「ECとLINEをつなぐ配管の点検口」。専用機能から設定へ移した（2026-09-16）。
      { href: '/ec-commerce', label: 'EC連携', icon: 'M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z', badge: 'unmatched' , id: 'ec-commerce', note: 'ECの会員・注文・定期便データを取り込みます', featureKey: 'ec_commerce' },
      { href: '/line-notifications', label: 'LINE通知', icon: 'M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9', id: 'line-notifications', note: '注文・入金・発送・返金・定期便の重要なお知らせ', featureKey: 'line_notifications' },
    ],
  },
  {
    // Pen R-1〜R-8を正本とする検証専用領域。既存の予約・配信とは別URLにし、
    // 後日この区分ごと別サーバーへ切り出せる構造にする。
    id: 'restaurant-test',
    label: '飲食店向け（テスト）',
    title: '飲食店向け（テスト）',
    items: [
      { href: '/restaurant-test/dashboard', label: '店舗ダッシュボード', icon: 'M3 3v18h18M7 16v2m4-6v6m4-10v10m4-14v14', id: 'restaurant-dashboard', note: '全店の予約・空席・売上予測・連携状態', featureKey: 'restaurant_test' },
      { href: '/restaurant-test/organization', label: '組織・権限', icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M15 7a3 3 0 11-6 0 3 3 0 016 0z', id: 'restaurant-organization', note: '本部・店舗・スタッフの権限と連携アカウント', featureKey: 'restaurant_test' },
      { href: '/restaurant-test/approvals', label: '承認ワークフロー', icon: 'M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11', id: 'restaurant-approvals', note: 'GBP投稿・LINE配信・メニュー改定の承認', featureKey: 'restaurant_test' },
      { href: '/restaurant-test/reservations', label: '予約台帳', icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z', id: 'restaurant-reservations', note: '媒体別の予約、配席、顧客カルテを一元表示', featureKey: 'restaurant_test' },
      { href: '/restaurant-test/tables', label: '座席・卓管理', icon: 'M4 6h16M6 6v12m12-12v12M4 18h16M9 10h6v4H9z', id: 'restaurant-tables', note: 'フロア、席種、収容人数、結合ルール', featureKey: 'restaurant_test' },
      { href: '/restaurant-test/inventory', label: '予約枠・在庫', icon: 'M3 5h18v14H3zM3 10h18M8 5v14M13 5v14M18 5v14', id: 'restaurant-inventory', note: '時間帯と媒体別の受入枠を管理', featureKey: 'restaurant_test' },
      { href: '/restaurant-test/menu', label: 'メニュー管理', icon: 'M4 6h16M4 10h16M4 14h10M4 18h10', id: 'restaurant-menu', note: 'コース・単品・価格・アレルギー情報', featureKey: 'restaurant_test' },
      { href: '/restaurant-test/google', label: 'Google・口コミ', icon: 'M21 12a9 9 0 11-2.64-6.36M21 4v6h-6', id: 'restaurant-google', note: 'GBP口コミ返信と最新情報の下書き管理', featureKey: 'restaurant_test' },
      { href: '/restaurant-test/line-followup', label: 'LINE来店フォロー', icon: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z', id: 'restaurant-line-followup', note: '予約前・来店後・口コミ・会員証のLINEカード', featureKey: 'restaurant_test' },
    ],
  },
]

/** 区分の目印から中身を引く。 */
export const MENU_SECTION_BY_ID = new Map(MENU_SECTIONS.map((section) => [section.id, section]))

/**
 * 画面 → 左メニューの所属の正本（#984 LAY-15）。
 *
 * ほとんどの画面は、パスの前方一致で「どの項目の配下か」が決まる。
 * 例外だけをここへ書く。URL上の置き場と、使う人が属すると感じる
 * メニューが違う画面があるため。
 *
 * 例: UID移行は `/accounts?tab=migration` に置いてあるが、画面の中身は
 * 友だちの主タブの1枚（友だち一覧／重複検出／統合ユーザー／UID移行）。
 * LINEアカウント設定の一部ではないので、ここで「友だち」のものと宣言する。
 *
 * キーは `パス?クエリ`（クエリが無い画面はパスだけ）。クエリの並びや
 * 余分なパラメータに左右されないよう、照合は `menuOwnerForScreen` を
 * 通す（キーのクエリは「この組が揃っていること」の条件として読む）。
 * 値は所属先の MenuItem.id。値が示す項目がメニューから外れた場合、
 * 宣言は効かず通常のパス一致へ戻る（サイドバー側でそう扱う）。
 */
export const SCREEN_MENU_OWNER: Record<string, string> = {
  '/accounts?tab=migration': 'friends',
}

/**
 * いまの画面が宣言済みの所属を持つなら、その MenuItem.id を返す。
 *
 * `?tab=migration&from=sidebar` のように宣言へ無いパラメータが
 * 増えても、`tab=migration` が揃っている限り同じ画面として扱う。
 * パラメータの並び順にも依存しない。
 */
export function menuOwnerForScreen(pathname: string, search: string): string | undefined {
  const current = new URLSearchParams(search)
  for (const [screen, ownerId] of Object.entries(SCREEN_MENU_OWNER)) {
    const [path, query = ''] = screen.split('?')
    if (path !== pathname) continue
    const required = new URLSearchParams(query)
    const satisfied = Array.from(required.entries()).every(([key, value]) => current.get(key) === value)
    if (satisfied) return ownerId
  }
  return undefined
}

/**
 * 保存された並び順を当てる。
 *
 * 知らない目印は捨て、保存に無い項目は元の位置のうしろへ残す。こうしないと、
 * 項目が増えたときに新しい項目が消える。
 */
export function applyItemOrder(section: MenuSection, order: string[] | undefined): MenuSection {
  if (!order || order.length === 0) return section

  const byId = new Map(section.items.map((item) => [item.id, item]))
  const saved: MenuItem[] = []
  for (const id of order) {
    const item = byId.get(id)
    if (item && !saved.includes(item)) saved.push(item)
  }
  if (saved.length === 0) return section

  /*
   * 保存に無い項目を、**定義の並びで隣にいる項目の横**に入れる。
   *
   * 以前は末尾にまとめていた。そうすると、**これから足すメニューが
   * 全部いちばん下に落ちる**。並び順を一度でも保存したことがある人には、
   * 新しい機能が毎回下に現れることになり、気づかない人が出る。
   * 実際、「共通情報」を足したときに「登録メディア一覧」の下に回った。
   *
   * 保存された並びは動かさない。動かすと、わざわざ並べ替えた人の
   * 意図を壊す。新しい項目だけを、定義で前にいた項目のうしろへ差し込む。
   */
  const savedSet = new Set(saved)
  const result = [...saved]
  let previous: MenuItem | null = null
  for (const item of section.items) {
    if (savedSet.has(item)) {
      previous = item
      continue
    }
    // 定義で前にいた「保存済みの項目」のうしろへ。前がいなければ先頭へ。
    const at = previous ? result.indexOf(previous) + 1 : 0
    result.splice(at, 0, item)
    previous = item
  }
  return { ...section, items: result }
}

/** 保存された並び順をまとめて当てる。 */
export function orderedMenuSections(itemOrder: Record<string, string[]> | null | undefined): MenuSection[] {
  return MENU_SECTIONS.map((section) => {
    const order = itemOrder?.[section.id]
    // V2で保存された専用機能の既定順は、V4の順番と正反対に近い。
    // 利用者が明示的に並べ替えた設定は残し、旧既定値だけV4へ移行する。
    const legacySpecialized = section.id === 'specialized'
      && order?.join(',') === 'ec-commerce,line-notifications,nen-campaigns,photo-review'
    return applyItemOrder(section, legacySpecialized ? undefined : order)
  })
}
