// リッチメニューの「土台のレイアウト」。areas は元画像のピクセル座標。
//
// クライアントは選んだテンプレを `templateToAreas()` で AreaInput[] に変換し、
// 新規作成の初期 areas として送る。
//
// サイズは LINE の2種類だけ:
//   大 (large)   2500 × 1686 … 画面をしっかり使う。6面まで載る
//   小 (compact) 2500 × 843  … トークが隠れにくい。横並び中心
//
// ここに無い形にしたいときは「自由に配置」を選び、編集画面で画像の上を
// ドラッグして区切る。ボタンは1ページあたり20個まで置ける。

export type RichMenuTemplate = {
  key: string;
  label: string;
  size: 'large' | 'compact';
  description?: string;
  areas: { x: number; y: number; w: number; h: number }[];
};

const LARGE = { width: 2500, height: 1686 };
const COMPACT = { width: 2500, height: 843 };

export const SIZE_DIMENSIONS = { large: LARGE, compact: COMPACT } as const;

/** 縦 rows × 横 cols に等しく割る。**設計 `XtfO3` は「面」と呼ぶ。** */
function grid(
  size: { width: number; height: number },
  rows: number,
  cols: number,
): RichMenuTemplate['areas'] {
  const w = size.width / cols;
  const h = size.height / rows;
  return Array.from({ length: rows * cols }, (_, i) => ({
    x: (i % cols) * w,
    y: Math.floor(i / cols) * h,
    w,
    h,
  }));
}

export const TEMPLATES: RichMenuTemplate[] = [
  // ---- 大サイズ ----
  {
    key: 'large-2x3',
    label: '6面（3列 × 2段）',
    size: 'large',
    description: 'いちばんよく使う形。項目が多いときに',
    areas: grid(LARGE, 2, 3),
  },
  {
    key: 'large-2x2',
    label: '4面（2列 × 2段）',
    size: 'large',
    description: '1つずつが大きく、押し間違えにくい',
    areas: grid(LARGE, 2, 2),
  },
  {
    key: 'large-1plus2',
    label: '上1・下2',
    size: 'large',
    description: '一番押してほしいものを上に置く',
    areas: [
      { x: 0, y: 0, w: LARGE.width, h: LARGE.height / 2 },
      { x: 0, y: LARGE.height / 2, w: LARGE.width / 2, h: LARGE.height / 2 },
      { x: LARGE.width / 2, y: LARGE.height / 2, w: LARGE.width / 2, h: LARGE.height / 2 },
    ],
  },
  {
    key: 'large-2plus1',
    label: '上2・下1',
    size: 'large',
    description: '下は親指が届きやすい。予約や購入を置く形',
    areas: [
      { x: 0, y: 0, w: LARGE.width / 2, h: LARGE.height / 2 },
      { x: LARGE.width / 2, y: 0, w: LARGE.width / 2, h: LARGE.height / 2 },
      { x: 0, y: LARGE.height / 2, w: LARGE.width, h: LARGE.height / 2 },
    ],
  },
  {
    key: 'large-left1right2',
    label: '左1・右2',
    size: 'large',
    description: '左の1つを主役にする形',
    areas: [
      { x: 0, y: 0, w: LARGE.width / 2, h: LARGE.height },
      { x: LARGE.width / 2, y: 0, w: LARGE.width / 2, h: LARGE.height / 2 },
      { x: LARGE.width / 2, y: LARGE.height / 2, w: LARGE.width / 2, h: LARGE.height / 2 },
    ],
  },
  {
    key: 'large-3x1',
    label: '横3面',
    size: 'large',
    description: '縦に長いボタンが3つ並ぶ',
    areas: grid(LARGE, 1, 3),
  },
  {
    key: 'large-1x2-v',
    label: '上下2面',
    size: 'large',
    description: '横長のボタンが2つ',
    areas: grid(LARGE, 2, 1),
  },
  {
    key: 'large-1x2-h',
    label: '左右2面',
    size: 'large',
    description: '大きなボタンが2つ',
    areas: grid(LARGE, 1, 2),
  },
  {
    key: 'large-full',
    label: '1面（全体で1つ）',
    size: 'large',
    description: '画像全体が1つのボタンになる',
    areas: grid(LARGE, 1, 1),
  },
  {
    key: 'large-empty',
    label: '自由に配置',
    size: 'large',
    description: '区切りなしで始めて、編集画面で好きな形に区切る',
    areas: [],
  },

  // ---- 小サイズ ----
  {
    key: 'compact-4x1',
    label: '横4面',
    size: 'compact',
    description: '小さめのボタンが4つ',
    areas: grid(COMPACT, 1, 4),
  },
  {
    key: 'compact-3x1',
    label: '横3面',
    size: 'compact',
    description: 'トークを隠さず、3つ並べる',
    areas: grid(COMPACT, 1, 3),
  },
  {
    key: 'compact-2x1',
    label: '左右2面',
    size: 'compact',
    description: '2つだけ置く',
    areas: grid(COMPACT, 1, 2),
  },
  {
    key: 'compact-full',
    label: '1面（全体で1つ）',
    size: 'compact',
    description: '細長い1つのボタン',
    areas: grid(COMPACT, 1, 1),
  },
  {
    key: 'compact-empty',
    label: '自由に配置',
    size: 'compact',
    description: '区切りなしで始めて、編集画面で好きな形に区切る',
    areas: [],
  },
];

export function templateToAreas(t: RichMenuTemplate) {
  return t.areas.map((a) => ({
    boundsX: Math.round(a.x),
    boundsY: Math.round(a.y),
    boundsWidth: Math.round(a.w),
    boundsHeight: Math.round(a.h),
    actionType: 'message' as const,
    actionData: { text: '' },
    // 作った直後は「メッセージを送る」。編集画面で変えられる。
    intent: 'text' as const,
  }));
}
