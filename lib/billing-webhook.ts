import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { contributionAmount, subscriptionStatus } from "./billing";
type Invoice = Stripe.Invoice & { parent?: { subscription_details?: { subscription?: string | { id: string } } } };
const idOf = (value: string | { id: string } | null | undefined) => typeof value === "string" ? value : value?.id;
function checked<T>(result: { data: T; error: { message: string } | null }): T {
  if (result.error) throw new Error(`Billing persistence failed: ${result.error.message}`);
  return result.data;
}
/** Re-fetch canonical state; delayed events must not restore an old Stripe status. */
async function syncSubscription(id: string, stripe: Stripe, db: SupabaseClient) {
  const subscription = await stripe.subscriptions.retrieve(id);
  const userId = subscription.metadata.user_id;
  if (!userId) throw new Error("Subscription is missing member metadata");
  const customerId = idOf(subscription.customer);
  const item = subscription.items.data[0] as Stripe.SubscriptionItem & { current_period_end?: number };
  const periodEnd = subscription.current_period_end || item?.current_period_end;
  if (!customerId || !periodEnd) throw new Error("Subscription has no customer or period end");
  const plan = subscription.metadata.plan;
  if (plan !== "monthly" && plan !== "yearly") throw new Error("Unrecognized membership plan");
  const saved = checked(await db.from("subscriptions").upsert({
    user_id: userId, stripe_customer_id: customerId, stripe_subscription_id: subscription.id,
    plan, status: subscriptionStatus(subscription.status),
    current_period_end: new Date(periodEnd * 1000).toISOString(), cancel_at_period_end: subscription.cancel_at_period_end,
  }, { onConflict: "stripe_subscription_id" }).select("id,user_id").single());
  if (!saved) throw new Error("Subscription was not saved");
  return saved as { id: string; user_id: string };
}
/** Checked writes + unique payment IDs make failure retries safe. */
export async function processBillingEvent(event: Stripe.Event, stripe: Stripe, db: SupabaseClient) {
  if (event.livemode) throw new Error("This assignment accepts sandbox events only");
  if (["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"].includes(event.type)) {
    await syncSubscription((event.data.object as Stripe.Subscription).id, stripe, db); return;
  }
  if (event.type === "invoice.paid") {
    const invoice = event.data.object as Invoice;
    const subscriptionId = idOf(invoice.subscription) || idOf(invoice.parent?.subscription_details?.subscription);
    if (!subscriptionId || !invoice.paid) return;
    if (invoice.currency !== "inr") throw new Error("Membership invoice must use INR");
    // invoice.paid can precede customer.subscription.created.
    const saved = await syncSubscription(subscriptionId, stripe, db);
    if (invoice.amount_paid <= 0) return;
    const choice = checked(await db.from("member_charities").select("charity_id,contribution_percent").eq("user_id", saved.user_id).maybeSingle());
    if (!choice) throw new Error("Member charity preference is missing");
    const amount = contributionAmount(invoice.amount_paid, Number(choice.contribution_percent));
    checked(await db.from("donations").upsert({ user_id: saved.user_id, charity_id: choice.charity_id, subscription_id: saved.id, amount, stripe_payment_id: `invoice_${invoice.id}` }, { onConflict: "stripe_payment_id", ignoreDuplicates: true }));
    return;
  }
  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    const session = event.data.object as Stripe.Checkout.Session;
    if (session.metadata?.type !== "independent_donation" || session.payment_status !== "paid") return;
    if (session.currency !== "inr" || !session.metadata.user_id || !session.metadata.charity_id || !session.amount_total) throw new Error("Invalid donation metadata");
    checked(await db.from("donations").upsert({ user_id: session.metadata.user_id, charity_id: session.metadata.charity_id, amount: session.amount_total / 100, stripe_payment_id: `checkout_${session.id}` }, { onConflict: "stripe_payment_id", ignoreDuplicates: true }));
  }
}
