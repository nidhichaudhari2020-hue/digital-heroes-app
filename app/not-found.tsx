import Link from "next/link";
import { SiteFooter, SiteHeader } from "@/components/site-header";

export default function NotFound() {
  return <>
    <SiteHeader />
    <main className="not-found-page">
      <section className="not-found-card">
        <p className="not-found-code">404 · NOT FOUND</p>
        <h1>This page has<br/><em>moved on.</em></h1>
        <p>The link may be out of date, or this cause is not available yet. Return home and keep the impact moving.</p>
        <Link className="button" href="/">Back to impact <span>→</span></Link>
      </section>
    </main>
    <SiteFooter />
  </>;
}
