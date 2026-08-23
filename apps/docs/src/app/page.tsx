import Link from 'next/link';
import { manuals } from '@/lib/manuals';

export default function HomePage() {
  return (
    <main>
      <section className="hero">
        <div className="hero__inner">
          <p className="eyebrow">GUIDE &amp; SUPPORT</p>
          <h1>musubo マニュアル</h1>
          <p className="hero__lead">
            日々の操作や設定方法を、画面を見ながら分かりやすく確認できます。
          </p>
        </div>
      </section>

      <section className="manual-index" aria-labelledby="manual-list-title">
        <div className="section-heading">
          <p className="eyebrow">MANUALS</p>
          <h2 id="manual-list-title">マニュアル一覧</h2>
        </div>
        <div className="manual-grid">
          {manuals.map((manual, index) => (
            <Link className="manual-card" href={`/manual/${manual.slug}/`} key={manual.slug}>
              <span className="manual-card__number">{String(index + 1).padStart(2, '0')}</span>
              <div>
                <p className="manual-card__category">{manual.category}</p>
                <h3>{manual.title}</h3>
                <p>{manual.summary}</p>
                <span className="manual-card__meta">{manual.readingTime}</span>
              </div>
              <span className="manual-card__arrow" aria-hidden="true">
                →
              </span>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
