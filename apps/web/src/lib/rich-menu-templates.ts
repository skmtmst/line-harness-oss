// LINE リッチメニュー の作成テンプレ。areas は元画像ピクセル座標。
// クライアントは選択したテンプレを `templateToAreas()` で AreaInput[] に変換し
// 新規 page の初期 areas として送る。
//
// v1 サポートサイズ: Large (2500x1686) / Compact (2500x843)。

export type RichMenuTemplate = {
  key: string;
  label: string;
  size: 'large' | 'compact';
  description?: string;
  areas: { x: number; y: number; w: number; h: number }[];
};

const LARGE = { width: 2500, height: 1686 };
const COMPACT = { width: 2500, height: 843 };

export const TEMPLATES: RichMenuTemplate[] = [
  {
    key: 'large-2x3',
    label: '2×3（大画像・6ボタン）',
    size: 'large',
    description: '2行 × 3列の標準レイアウト',
    areas: Array.from({ length: 6 }, (_, i) => ({
      x: (i % 3) * (LARGE.width / 3),
      y: Math.floor(i / 3) * (LARGE.height / 2),
      w: LARGE.width / 3,
      h: LARGE.height / 2,
    })),
  },
  {
    key: 'large-3x1',
    label: '3×1（横3分割）',
    size: 'large',
    description: '横並び3ボタン（画像は全高）',
    areas: [0, 1, 2].map((i) => ({
      x: i * (LARGE.width / 3),
      y: 0,
      w: LARGE.width / 3,
      h: LARGE.height,
    })),
  },
  {
    key: 'large-2x2',
    label: '2×2',
    size: 'large',
    description: '2行 × 2列',
    areas: Array.from({ length: 4 }, (_, i) => ({
      x: (i % 2) * (LARGE.width / 2),
      y: Math.floor(i / 2) * (LARGE.height / 2),
      w: LARGE.width / 2,
      h: LARGE.height / 2,
    })),
  },
  {
    key: 'large-1plus2',
    label: '1＋2（上1・下2）',
    size: 'large',
    description: '上段に大ボタン1、下段に2ボタン',
    areas: [
      { x: 0, y: 0, w: LARGE.width, h: LARGE.height / 2 },
      { x: 0, y: LARGE.height / 2, w: LARGE.width / 2, h: LARGE.height / 2 },
      { x: LARGE.width / 2, y: LARGE.height / 2, w: LARGE.width / 2, h: LARGE.height / 2 },
    ],
  },
  {
    key: 'large-empty',
    label: '空白（自由配置）',
    size: 'large',
    description: '領域なしで開始し、編集画面で自由に追加',
    areas: [],
  },
  {
    key: 'compact-3x1',
    label: '横3分割（低画像）',
    size: 'compact',
    description: '高さの低い画像で横3分割',
    areas: [0, 1, 2].map((i) => ({
      x: i * (COMPACT.width / 3),
      y: 0,
      w: COMPACT.width / 3,
      h: COMPACT.height,
    })),
  },
  {
    key: 'compact-empty',
    label: '空白（低画像）',
    size: 'compact',
    description: '高さの低い画像で領域なし',
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
  }));
}
