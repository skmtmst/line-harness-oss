export type ManualEntry = {
  slug: string;
  title: string;
  summary: string;
  category: string;
  readingTime: string;
};

export const manuals: ManualEntry[] = [
  {
    slug: 'line-account-setup',
    title: '記事テンプレート',
    summary: '手順、注意、補足、画像、トラブル解決の表示見本です。',
    category: 'はじめに',
    readingTime: '約3分',
  },
];

export function manualBySlug(slug: string): ManualEntry | undefined {
  return manuals.find((manual) => manual.slug === slug);
}
