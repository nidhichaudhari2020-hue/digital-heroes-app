export const MEMBERSHIP_PLANS = {
  monthly: {
    id: "monthly",
    name: "Monthly impact",
    amount: 299,
    interval: "month",
    description: "A flexible way to play, support your cause, and join the next draw.",
    highlight: "Flexible membership",
  },
  yearly: {
    id: "yearly",
    name: "Yearly impact",
    amount: 2999,
    interval: "year",
    description: "Twelve months of impact, with a lower annual price and uninterrupted access.",
    highlight: "Save ₹589 each year",
  },
} as const;

export type MembershipPlan = keyof typeof MEMBERSHIP_PLANS;

export function formatINR(value: number, maximumFractionDigits = 0) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits,
  }).format(Number.isFinite(value) ? value : 0);
}
