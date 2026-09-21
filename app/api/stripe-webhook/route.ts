import { headers } from "next/headers";
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { adminDb } from "@/lib/supabase/admin";

type InvoiceWithSubscription = Stripe.Invoice & { subscription?: string | Stripe.Subscription | null };

async function recordIndependentDonation(session: Stripe.Checkout.Session) {
  const metadata = session.metadata || {};
  if (metadata.type !== "independent_donation" || session.payment_status !== "paid") return;
  const amount = Number(session.amount_total || 0) / 100;
  if (!metadata.user_id || !metadata.charity_id || amount <= 0) return;
  await adminDb().from("donations").upsert({
    user_id: metadata.user_id,
    charity_id: metadata.charity_id,
    amount,
    stripe_payment_id: `checkout_${session.id}`,
  }, { onConflict: "stripe_payment_id" });
}

async function recordMembershipDonation(invoice: InvoiceWithSubscription) {
  const subscriptionId = typeof invoice.subscription === "string" ? invoice.subscription : invoice.subscription?.id;
  if (!subscriptionId || !invoice.paid) return;
  const db = adminDb();
  const { data: subscription } = await db
    .from("subscriptions")
    .select("id,user_id")
    .eq("stripe_subscription_id", subscriptionId)
    .maybeSingle();
  if (!subscription) return;
  const { data: choice } = await db
    .from("member_charities")
    .select("charity_id,contribution_percent")
    .eq("user_id", subscription.user_id)
    .maybeSingle();
  const paidAmount = Number(invoice.amount_paid || 0) / 100;
  if (!choice || paidAmount <= 0) return;
  const amount = Number((paidAmount * Number(choice.contribution_percent) / 100).toFixed(2));
  if (amount <= 0) return;
  await db.from("donations").upsert({
    user_id: subscription.user_id,
    charity_id: choice.charity_id,
    subscription_id: subscription.id,
    amount,
    stripe_payment_id: `invoice_${invoice.id}`,
  }, { onConflict: "stripe_payment_id" });
}

export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !process.env.STRIPE_SECRET_KEY) {
    return new NextResponse("Stripe is not configured", { status: 503 });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      await request.text(),
      (await headers()).get("stripe-signature") || "",
      secret,
    );
  } catch {
    return new NextResponse("Invalid webhook signature", { status: 400 });
  }

  if (["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"].includes(event.type)) {
    const subscription = event.data.object as Stripe.Subscription;
    const userId = subscription.metadata.user_id;
    if (userId) {
      const plan = subscription.metadata.plan === "yearly" ? "yearly" : "monthly";
      const status = subscription.status === "active"
        ? "active"
        : subscription.status === "past_due"
          ? "past_due"
          : subscription.status === "canceled"
            ? "cancelled"
            : "lapsed";
      await adminDb().from("subscriptions").upsert({
        user_id: userId,
        stripe_customer_id: String(subscription.customer),
        stripe_subscription_id: subscription.id,
        plan,
        status,
        current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
      }, { onConflict: "stripe_subscription_id" });
    }
  }

  if (event.type === "checkout.session.completed") {
    await recordIndependentDonation(event.data.object as Stripe.Checkout.Session);
  }
  if (event.type === "invoice.paid") {
    await recordMembershipDonation(event.data.object as InvoiceWithSubscription);
  }

  return NextResponse.json({ received: true });
}
