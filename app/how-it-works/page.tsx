import Link from "next/link";
import { SiteFooter, SiteHeader } from "@/components/site-header";

const steps = [
  ["01", "Choose your impact", "Pick a cause that means something to you and direct at least 10% of your membership towards it."],
  ["02", "Keep your five", "Log your latest Stableford rounds. We retain a clear, rolling view of your five most recent scores."],
  ["03", "Enter the draw", "Active members can submit a five-number entry for the monthly prize draw and see every result in one place."],
  ["04", "Make it count", "Prize tiers reward three, four, and five matches. Unclaimed five-match money rolls into the next jackpot."],
];
export default function HowItWorksPage() { return <><SiteHeader/><main><section className="page-hero"><p className="eyebrow">THE BETTER MEMBERSHIP LOOP</p><h1>Play your game.<br/><em>Pass it on.</em></h1><p>impact. gives every round a little more reach - for your game, your community, and the cause you choose.</p></section><section className="steps-section">{steps.map(([number,title,copy])=><article className="large-step" key={number}><span>{number}</span><div><h2>{title}</h2><p>{copy}</p></div></article>)}</section><section className="dark-cta"><p className="eyebrow">READY WHEN YOU ARE</p><h2>Start with the<br/><em>why.</em></h2><Link className="button button--light" href="/auth">Create your membership</Link></section></main><SiteFooter/></>; }
