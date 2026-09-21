import Link from "next/link";

export function SiteHeader({ compact = false }: { compact?: boolean }) {
  return <header className={`site-header ${compact ? "site-header--compact" : ""}`}>
    <Link className="brand" href="/">impact<b>.</b></Link>
    <nav aria-label="Primary navigation">
      <Link href="/how-it-works">How it works</Link>
      <Link href="/charities">Causes</Link>
      <Link href="/draw">The draw</Link>
    </nav>
    <details className="mobile-nav">
      <summary aria-label="Open navigation">Menu</summary>
      <nav aria-label="Mobile navigation">
        <Link href="/how-it-works">How it works</Link>
        <Link href="/charities">Causes</Link>
        <Link href="/draw">The draw</Link>
        <Link href="/auth">Member access</Link>
      </nav>
    </details>
    <Link className="button button--small" href="/auth">Join impact.</Link>
  </header>;
}

export function SiteFooter() {
  return <footer className="site-footer">
    <div><Link className="brand" href="/">impact<b>.</b></Link><p>Play your game. Move a cause forward.</p></div>
    <div className="footer-links"><Link href="/charities">Explore causes</Link><Link href="/draw">Monthly draw</Link><Link href="/auth">Member access</Link></div>
    <small>© 2026 impact. Built for the Digital Heroes selection assignment.</small>
  </footer>;
}
