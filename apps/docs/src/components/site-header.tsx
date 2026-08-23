import Link from 'next/link';

export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="site-header__inner">
        <Link className="brand" href="/" aria-label="musubo マニュアル トップ">
          <span className="brand__mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span className="brand__text">
            <strong>musubo</strong>
            <small>MANUAL</small>
          </span>
        </Link>
        <Link className="header-link" href="/">
          マニュアル一覧
        </Link>
      </div>
    </header>
  );
}
