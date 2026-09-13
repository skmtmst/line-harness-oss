import { arrow, button } from "./shared.mjs";

const icons = {
  send: '<path d="m3 11 18-8-8 18-2-8-8-2Z"/><path d="m11 13 10-10"/>',
  people:
    '<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M17 5a3 3 0 0 1 0 6M18 15a5 5 0 0 1 3 5"/>',
  chat: '<path d="M21 11a9 9 0 0 1-9 9H3l2-5a9 9 0 1 1 16-4Z"/><path d="M8 10h8M8 14h5"/>',
  form: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h3"/>',
  image:
    '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="m3 16 5-5 5 5 3-3 5 5"/><circle cx="15" cy="8" r="1"/>',
  store: '<path d="M3 9h18l-2-6H5L3 9ZM5 12v9h14v-9M10 21v-7h4v7"/>',
};
export const icon = (key) =>
  `<svg viewBox="0 0 24 24" width="27" height="27" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[key]}</svg>`;

export function home(config, production) {
  const app = production ? config.productionAppOrigin : config.stagingAppOrigin;
  const features = [
    [
      "send",
      "届ける",
      "伝えたいことを、ちょうどよく。",
      "一斉配信から、友だちの属性に合わせた配信、順番に届けるステップ配信まで。目的に合う伝え方を選べます。",
      "メッセージ配信 / ステップ配信",
    ],
    [
      "people",
      "知る",
      "一人ひとりが、見えてくる。",
      "友だちの情報やタグ、フォームの回答を整理。やりとりの背景がわかるから、次の会話も自然につながります。",
      "友だち管理 / タグ・属性",
    ],
    [
      "chat",
      "話す",
      "会話に、ちゃんと向き合う。",
      "個別チャットと自動応答を使い分け。繰り返しのご案内を整えて、人にしかできない対応に時間を使えます。",
      "1対1チャット / 自動応答",
    ],
    [
      "form",
      "受け付ける",
      "お客さまの「したい」を、すぐに。",
      "アンケートや申込みのフォーム、予約の受付をLINEにつなげて。会話から次の行動への流れをつくります。",
      "回答フォーム / 予約管理",
    ],
    [
      "image",
      "つくる",
      "伝わる見た目も、ひとつの場所で。",
      "リッチメニューやテンプレート、AIによるバナー生成。参照画像を使った画像づくりにも対応しています。",
      "リッチメニュー / バナー生成",
    ],
    [
      "store",
      "まとめる",
      "ひとつのお店から、チームへ。",
      "複数店舗の情報やメンバーの権限をまとめて管理。共通のテンプレートを使いながら、各店舗で運用できます。",
      "統括コンソール / メンバー管理",
    ],
  ];
  return `<section class="hero wrap"><div class="hero-copy"><p class="eyebrow"><span class="dot"></span> お店とお客さまを結ぶ、LINE運用ツール</p>
<h1>そのつながりを、<br>もっと、<span class="headline-accent">育てよう。</span></h1>
<p class="hero-lead">「また来たい」のきっかけを、いつものLINEから。<br class="desktop-break">配信も、お客さまの管理も、日々のやりとりも。<br class="desktop-break">musuboで、ひとつに。</p>
<div class="hero-actions">${button(`${app}/register`, "無料で新規登録")}<a class="text-link" href="#features">できることを見る <span aria-hidden="true">↓</span></a></div><p class="micro">30日間の無料トライアル · 有料プランは登録後に選べます</p></div>
<div class="hero-visual"><div class="visual-label"><span>つながりが育つ、毎日へ。</span><span class="small-symbol" aria-hidden="true">✳</span></div>
<div class="product-window"><div class="window-header"><span class="mini-brand">musubo</span><span class="sample-label">表示はサンプル</span></div><div class="product-body"><div class="product-sidebar" aria-hidden="true">${icon("store")}${icon("people")}${icon("send")}${icon("chat")}</div>
<div class="product-content"><div class="product-heading"><span class="micro">メッセージ配信</span><span class="tag">配信予約</span></div><h2>次の「また来たい」を。</h2><div class="message-paper"><div class="paper-header"><span class="shop-avatar">m</span><span>いつものお店<small>お客さまへのメッセージ</small></span></div><div class="message-line"></div><p class="message-title">日常に、<br>ちいさな楽しみを。</p><p>季節の新しいメニューができました。<br>またお会いできるのを、楽しみにしています。</p><div class="paper-footer">お店のお知らせを見る <span aria-hidden="true">→</span></div></div><div class="delivery-summary"><span class="dot"></span><span>興味のある方へ、選んで届ける</span></div></div></div></div>
<div class="floating-note"><span class="note-check" aria-hidden="true">✓</span><div>届いて、つながる。<small>一人ひとりに合ったコミュニケーション</small></div></div></div></section>
<div class="intro-line wrap"><span>LINEの運用を、ひとつの流れに。</span><p>届ける <span>—</span> 知る <span>—</span> 話す <span>—</span> またつながる</p></div>

<section class="section wrap" id="features"><div class="section-heading"><div><p class="eyebrow">できること</p><h2>手間は少なく。<br>関係は、深く。</h2></div><p>機能を使いこなすことよりも、<br>お客さまと向き合うことに時間を。<br>毎日の運用に必要な道具を揃えました。</p></div>
<div class="feature-grid">${features.map(([key, label, title, body, meta], i) => `<article class="feature"><div class="feature-top">${icon(key)}<span>0${i + 1} / ${label}</span></div><h3>${title}</h3><p>${body}</p><small>${meta}</small></article>`).join("")}</div></section>

<section class="experience-section"><div class="wrap experience-grid"><div><p class="eyebrow">使うほど、自然に。</p><h2>やりたいことから、<br>迷わず、はじめる。</h2><p>難しい設定を並べるのではなく、<br>日々の仕事の流れに沿って。<br>musuboの使い方を、少しだけご紹介します。</p><div class="demo-controls" aria-label="使い方の表示切替"><button class="demo-tab is-active" data-demo="delivery" aria-pressed="true">01 配信する <span aria-hidden="true">→</span></button><button class="demo-tab" data-demo="customers" aria-pressed="false">02 お客さまを知る <span aria-hidden="true">→</span></button><button class="demo-tab" data-demo="creative" aria-pressed="false">03 見た目を整える <span aria-hidden="true">→</span></button></div></div>
<div class="demo-surface" aria-live="polite" aria-atomic="true">
<div class="demo-panel" data-panel="delivery"><p class="demo-eyebrow">配信の流れ</p><h3>誰に、何を、いつ届ける？</h3><ol class="flow-list"><li><span>1</span><div><strong>届ける相手を選ぶ</strong><p>すべての友だち、またはタグや属性で絞り込み。</p></div><span class="flow-icon">✓</span></li><li><span>2</span><div><strong>メッセージをつくる</strong><p>文章と画像を組み合わせて、伝えたいことを。</p></div><span class="flow-icon">✓</span></li><li><span>3</span><div><strong>確認して、配信を予約</strong><p>内容と宛先を確かめて、ちょうどよい時間に。</p></div><span class="flow-icon">✓</span></li></ol><div class="demo-foot">日々のお知らせも、次のご案内も。<span aria-hidden="true">↗</span></div></div>
<div class="demo-panel" data-panel="customers" hidden><p class="demo-eyebrow">友だち管理</p><h3>会話の背景が、ひと目で。</h3><div class="customer-sample"><span class="customer-avatar">友</span><div><strong>友だちのプロフィール</strong><p>表示は架空のサンプルです</p></div></div><div class="sample-tags"><span>新商品に興味</span><span>フォーム回答済み</span><span>来店経験あり</span></div><div class="sample-record"><span>タグ・属性</span><p>興味や関心に合わせて情報を整理</p><span>チャット</span><p>これまでのやりとりを確認</p></div><div class="demo-foot">一人ひとりに合う、次のひとことへ。<span aria-hidden="true">↗</span></div></div>
<div class="demo-panel" data-panel="creative" hidden><p class="demo-eyebrow">バナー生成</p><h3>イメージを、伝わるかたちに。</h3><ol class="flow-list"><li><span>1</span><div><strong>用途と伝えたい内容を入力</strong><p>LINEやSNSなど、届ける場所に合わせて。</p></div></li><li><span>2</span><div><strong>必要なら参照画像を追加</strong><p>土台として描き直す、または雰囲気を参考に。</p></div></li><li><span>3</span><div><strong>生成した画像を確認</strong><p>表現や権利を確認してから、配信に活用。</p></div></li></ol><div class="demo-foot">※この画面では実際の画像生成は行いません。</div></div>
</div></div><p class="wrap demo-caption">使い方のイメージです。実際の管理画面の表示とは異なります。</p></section>

<section class="section wrap" id="start"><div class="section-heading"><div><p class="eyebrow">はじめ方</p><h2>最初の一歩は、<br>シンプルに。</h2></div><p>まずはアカウントをつくって、<br>お店のLINE運用を整えていきましょう。</p></div><ol class="start-steps"><li><span class="step-number">01</span><h3>メールで新規登録</h3><p>メールアドレスを入力し、届いた案内から登録を完了します。</p></li><li><span class="step-number">02</span><h3>LINE公式アカウントを連携</h3><p>お店の情報を設定し、利用するLINE公式アカウントをつなぎます。</p></li><li><span class="step-number">03</span><h3>お客さまと、つながる</h3><p>メッセージやフォームを用意して、日々の運用をはじめましょう。</p></li></ol><p class="setup-note">LINE公式アカウントの管理権限と、Messaging APIの設定が必要です。</p></section>

<section class="plans-section wrap" id="plans"><div class="plans-copy"><p class="eyebrow">料金について</p><h2>まずは、<br>お店に合うかどうか。</h2><p>30日間の無料トライアルで、操作や使い心地を<br class="desktop-break">お確かめください。有料プランはそのあとに。</p>${button(`${app}/register`, "無料で新規登録", "light")}</div><div class="trial-details"><p class="trial-number"><strong>30</strong><span>日間<br>無料トライアル</span></p><ul><li>メールアドレスで登録できます</li><li>有料プランはご自身で選んで申し込み</li><li>未契約の場合、期間終了後に配信・生成が停止</li></ul><p class="price-note">${production ? "有料プランの料金・条件は" : "有料プランの正式料金は公開前に確定します。現在のプランは"}管理画面の「課金プラン」でご確認ください。LINE公式アカウントの利用料や通信費は別途必要になる場合があります。<a href="/legal/">取引条件を見る ${arrow}</a></p></div></section>

<section class="section wrap faq-section" id="faq"><div><p class="eyebrow">よくある質問</p><h2>気になることを、<br>はじめる前に。</h2></div><div class="faq-list">${[
    [
      "LINE公式アカウントとの違いは何ですか？",
      "musuboはLINE公式アカウントに連携して使う運用ツールです。配信の管理、友だち情報の整理、フォームや予約、複数店舗の管理などをひとつの場所で行えます。LINE公式アカウントそのものの代わりではありません。",
    ],
    [
      "今使っているLINE公式アカウントを使えますか？",
      "管理権限のあるLINE公式アカウントを連携する設計です。すでに他のツールを使っている場合はWebhookなどの設定確認が必要です。切り替える前に現在の連携先と運用を確認してください。",
    ],
    [
      "複数の店舗やメンバーで使えますか？",
      "統括コンソールで店舗やメンバーを管理できます。利用できるアカウント数やメンバー数などはプランによって異なります。管理画面の「課金プラン」でご確認ください。",
    ],
    [
      "無料トライアルが終わると、自動で課金されますか？",
      "有料プランへの申込みなしに、自動で課金されることはありません。未契約の場合、トライアル終了後は配信とバナー生成が停止します。続けて利用するには管理画面からプランをお選びください。",
    ],
    [
      "解約はどこでできますか？",
      "管理画面の「課金プラン」から「支払い方法を管理」へ進みます。更新・解約の適用時期、返金の条件は申込時の表示と「特定商取引法に基づく表記」をご確認ください。",
    ],
  ]
    .map(
      ([question, answer]) =>
        `<details><summary>${question}<span aria-hidden="true"></span></summary><p>${answer}</p></details>`,
    )
    .join("")}</div></section>

<section class="closing wrap"><div class="closing-mark" aria-hidden="true"><img src="/assets/symbol.svg" width="68" height="68" alt=""></div><p class="eyebrow">人と人を、結ぼう。</p><h2>つながりの先に、<br class="mobile-break">また会いたい人がいる。</h2><p>その関係を育てる道具でありたい。musuboです。</p>${button(`${app}/register`, "musuboを無料ではじめる")}<a class="closing-login" href="${app}/login">アカウントをお持ちの方はログイン ${arrow}</a></section>`;
}
