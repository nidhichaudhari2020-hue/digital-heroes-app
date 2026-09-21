import Link from "next/link";

import {
  SiteFooter,
  SiteHeader,
} from "@/components/site-header";

import { MembershipPlans } from "@/components/membership-button";

import { getPublicImpact } from "@/lib/public-impact";
import { formatINR } from "@/lib/pricing";

const steps = [
  [
    "01",
    "Make it personal",
    "Choose a membership and a cause you believe in. At least 10% of your fee supports your chosen charity.",
  ],
  [
    "02",
    "Find your rhythm",
    "Save your latest five Stableford scores. A little progress, one round at a time.",
  ],
  [
    "03",
    "Share the good",
    "Enter the monthly draw. Follow transparent prize tiers and your contribution history.",
  ],
];

/*
  Homepage causes

  IMPORTANT:
  Change the href values below if your actual charity
  slugs are different.
*/
const causes = [
  {
    number: "01",
    name: "Mind",
    description: "Mental health support and advocacy.",
    href: "/charities/mind",
  },
  {
    number: "02",
    name: "WaterAid",
    description:
      "Helping communities access clean water, sanitation, and better health.",
    href: "/charities/wateraid",
  },
  {
    number: "03",
    name: "Shelter",
    description:
      "Supporting people and families facing homelessness and housing insecurity.",
    href: "/charities/shelter",
  },
];

export default async function Home() {
  const impact = await getPublicImpact();

  const draw = impact?.draw;
  const numbers = draw?.numbers || [];

  return (
    <>
      <SiteHeader />

      <main>
        {/* ==================================================
            HERO
        ================================================== */}

        <section className="hero-v2">
          <div className="hero-v2__content">
            <p className="eyebrow">
              A LITTLE PLAY. A BIGGER PURPOSE.
            </p>

            <h1>
              Every round
              <br />
              can <em>matter.</em>
            </h1>

            <p className="hero-copy">
              For the game you love. For the world you care
              about. Turn your next round into support for a
              cause that means something to you.
            </p>

            <div className="hero-actions">
              <Link className="button" href="/auth">
                Find your impact <span>↗</span>
              </Link>

              <Link
                className="text-link"
                href="/how-it-works"
              >
                See how it works
              </Link>
            </div>

            <div className="trust-notes">
              <span>From ₹299 / month</span>
              <span>Your choice of cause</span>
            </div>

            <div className="impact-stat">
              <b>
                {impact
                  ? formatINR(
                      Number(impact.donated),
                      2
                    )
                  : "—"}
              </b>

              <span>
                {impact
                  ? "recorded contributions"
                  : "Impact data unavailable"}
                <br />
                in this evaluation platform
              </span>
            </div>
          </div>

          <div
            className="hero-art"
            aria-label="Illustration of a member score and charitable contribution"
          >
            <div className="hero-sun" />

            <article className="score-float">
              <small>
                EXAMPLE ROUND <b>↗</b>
              </small>

              <strong>38</strong>

              <span>
                STABLEFORD POINTS{" "}
                <em>OUT OF 45</em>
              </span>
            </article>

            <article className="cause-float">
              <i>♥</i>

              <p>
                10% of a monthly membership is
              </p>

              <strong>₹29.90</strong>

              <p>for a cause you choose.</p>

              <div>
                <span />
              </div>

              <small>
                ILLUSTRATIVE CONTRIBUTION
              </small>
            </article>

            <span className="hero-art-caption">
              SMALL MOMENTS. MEANINGFUL CHANGE.
            </span>
          </div>
        </section>

        {/* ==================================================
            TICKER
        ================================================== */}

        <div className="ticker">
          <span>PLAY YOUR GAME</span>
          <i>✦</i>
          <span>BACK A CAUSE</span>
          <i>✦</i>
          <span>SHARE THE POSSIBILITY</span>
        </div>

        {/* ==================================================
            HOW IT WORKS
        ================================================== */}

        <section className="intro-block">
          <div>
            <p className="eyebrow">
              GOOD STARTS WITH YOU
            </p>

            <h2>
              Give your golf
              <br />
              a bigger <em>why.</em>
            </h2>
          </div>

          <div className="signal-grid">
            {steps.map(
              ([number, title, copy]) => (
                <article key={number}>
                  <span>{number}</span>
                  <i>↗</i>

                  <h3>{title}</h3>

                  <p>{copy}</p>
                </article>
              )
            )}
          </div>
        </section>

        {/* ==================================================
            MEMBERSHIP
        ================================================== */}

        <section
          className="membership-showcase"
          id="membership"
        >
          <div>
            <p className="eyebrow">
              MEMBERSHIP, WITH MEANING
            </p>

            <h2>
              Your game.
              <br />
              Your <em>good.</em>
            </h2>

            <p>
              Monthly flexibility or a year of
              possibility. Choose your cause,
              track your rounds, and keep your
              impact in view.
            </p>

            <p>
              ₹100 per active member is allocated
              to each monthly draw. This evaluation
              build uses sandbox payments only.
            </p>
          </div>

          <MembershipPlans />
        </section>

        {/* ==================================================
            DRAW
        ================================================== */}

        <section className="draw-banner">
          <div>
            <p className="eyebrow eyebrow--light">
              {draw?.label ||
                "THE MONTHLY DRAW"}
            </p>

            <h2>
              Good form.
              <br />
              <em>Real possibility.</em>
            </h2>

            <p>
              Three tiers. Equal shares within each
              tier. A five-match jackpot that carries
              forward when there are no five-match
              winners.
            </p>

            <Link
              className="ghost-button"
              href="/draw"
            >
              Understand the draw →
            </Link>
          </div>

          <div className="draw-widget">
            <div>
              <span>
                {draw
                  ? draw.status === "draft"
                    ? "OPEN DRAW POOL"
                    : "PUBLISHED DRAW POOL"
                  : "AWAITING NEXT DRAW"}
              </span>

              <b>
                {draw
                  ? formatINR(
                      Number(draw.prize_pool) +
                        Number(draw.jackpot),
                      2
                    )
                  : "—"}
              </b>
            </div>

            <section>
              {Array.from(
                { length: 5 },
                (_, i) => (
                  <i
                    className={`ball ball-${i}`}
                    key={i}
                  >
                    {numbers[i]
                      ? String(
                          numbers[i]
                        ).padStart(2, "0")
                      : "?"}
                  </i>
                )
              )}
            </section>

            <footer>
              <span>
                {draw
                  ? new Date(
                      draw.draw_date
                    ).toLocaleDateString(
                      "en-IN",
                      {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                        timeZone:
                          "Asia/Kolkata",
                      }
                    )
                  : "NO RESULT HAS BEEN PUBLISHED"}
              </span>

              <span>5 · 4 · 3 MATCHES</span>
            </footer>
          </div>
        </section>

        {/* ==================================================
            ALL THREE CAUSES
        ================================================== */}

        <section className="causes-home">
          <div className="section-heading">
            <div>
              <p className="eyebrow">
                YOUR IMPACT, YOUR CHOICE
              </p>

              <h2>
                Back what
                <br />
                <em>moves you.</em>
              </h2>
            </div>

            <Link
              className="text-link"
              href="/charities"
            >
              See all causes →
            </Link>
          </div>

          <div className="home-causes-grid">
            {causes.map((cause) => (
              <article
                className="home-cause-card"
                key={cause.number}
              >
                <span className="home-cause-number">
                  {cause.number}
                </span>

                <div className="home-cause-content">
                  <h3>{cause.name}</h3>

                  <p>
                    {cause.description}
                  </p>

                  <Link
                    href={cause.href}
                    className="text-link"
                  >
                    Meet the cause →
                  </Link>
                </div>
              </article>
            ))}
          </div>
        </section>

        {/* ==================================================
            FINAL CTA
        ================================================== */}

        <section className="final-cta">
          <p className="eyebrow">
            MAKE THE NEXT ROUND COUNT
          </p>

          <h2>
            A better game.
            <br />
            A little more <em>good.</em>
          </h2>

          <Link
            className="button"
            href="/auth"
          >
            Start your membership ↗
          </Link>
        </section>
      </main>

      <SiteFooter />
    </>
  );
}