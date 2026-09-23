/** Gateway amounts are integer paise; persisted amounts are INR. */
export function contributionAmount(paidPaise: number, percentage: number): number {
  if (!Number.isSafeInteger(paidPaise) || paidPaise < 0) throw new Error("Invalid paid amount");
  if (!Number.isFinite(percentage) || percentage < 10 || percentage > 100) throw new Error("Invalid contribution percentage");
  return Math.round(paidPaise * percentage / 100) / 100;
}
export function subscriptionStatus(status: string): "active" | "past_due" | "cancelled" | "lapsed" {
  if (status === "active") return "active";
  if (status === "past_due" || status === "unpaid") return "past_due";
  if (status === "canceled") return "cancelled";
  return "lapsed";
}
export function isActiveSubscription(subscription: { status: string; current_period_end: string | null } | null, now = Date.now()) {
  return Boolean(subscription?.status === "active" && subscription.current_period_end && new Date(subscription.current_period_end).getTime() > now);
}
export function appUrl(requestOrigin?: string) {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (configured && (!process.env.VERCEL || !/localhost|127\.0\.0\.1/.test(configured))) return new URL(configured).origin;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return requestOrigin ? new URL(requestOrigin).origin : process.env.VERCEL ? "https://digital-heroes-app-one.vercel.app" : "http://localhost:3000";
}
export function billingConfigured() { return /^sk_test_[A-Za-z0-9]+$/.test(process.env.STRIPE_SECRET_KEY || ""); }
