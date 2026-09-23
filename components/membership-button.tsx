"use client";

import { useState } from "react";
import { formatINR, MEMBERSHIP_PLANS, type MembershipPlan } from "@/lib/pricing";

export function MembershipButton({ plan }: { plan: MembershipPlan }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function checkout() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const data = await response.json().catch(() => ({}));
      if (data.url) location.assign(data.url);
      else if (response.status === 401) location.assign(`/auth?plan=${plan}`);
      else if (data.code === "CHARITY_REQUIRED") {
        setError(data.error);
        if (location.pathname !== "/dashboard") location.assign("/dashboard#charity-choice");
        else document.getElementById("charity-choice")?.scrollIntoView({ behavior: "smooth" });
      }
      else setError(data.error || "Unable to start checkout. Please try again.");
    } catch {
      setError("We could not open checkout. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return <><button className="button" onClick={checkout} disabled={busy}>{busy ? "Opening secure checkout…" : `Choose ${MEMBERSHIP_PLANS[plan].name}`}</button>{error && <p role="alert" className="form-notice">{error}</p>}</>;
}

export function MembershipPlans({ compact = false }: { compact?: boolean }) {
  return <div className="membership-plans" aria-label="Membership plans">
    {(Object.keys(MEMBERSHIP_PLANS) as MembershipPlan[]).map((planId) => {
      const plan = MEMBERSHIP_PLANS[planId];
      return <article className={`membership-plan ${planId === "yearly" ? "membership-plan--featured" : ""} ${compact ? "membership-plan--compact" : ""}`} key={plan.id}>
        <span className={`membership-plan__tag ${planId === "yearly" ? "" : "membership-plan__tag--quiet"}`}>{plan.highlight}</span>
        <h3>{plan.name}</h3>
        <p>{plan.description}</p>
        <div className="membership-plan__price"><b>{formatINR(plan.amount)}</b><span>per {plan.interval}</span></div>
        <MembershipButton plan={planId} />
        <small className="membership-plan__note">Stripe sandbox · Manage or cancel billing from your dashboard</small>
      </article>;
    })}
  </div>;
}
