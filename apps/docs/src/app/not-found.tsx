import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="not-found">
      <p className="not-found__code">404</p>
      <p className="eyebrow">PAGE NOT FOUND</p>
      <h1>ページが見つかりません</h1>
      <p>URLが変わったか、ページが削除された可能性があります。</p>
      <Link className="primary-link" href="/">
        マニュアル一覧へ戻る
      </Link>
    </main>
  );
}
