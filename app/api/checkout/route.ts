import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@/lib/supabase/server";
import { appUrl, billingConfigured } from "@/lib/billing";
import { MEMBERSHIP_PLANS } from "@/lib/pricing";

export async function POST(request: Request) {
  if (request.headers.get("origin") && request.headers.get("origin") !== new URL(request.url).origin) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  try {
    const db = await createClient();
    const { data: { user } } = await db.auth.getUser();
    if (!user) return NextResponse.json({ error: "Please log in first." }, { status: 401 });
    if (!billingConfigured()) return NextResponse.json({ error: "Payments are unavailable because Stripe test billing is not configured. Please contact the administrator. No payment has been taken." }, { status: 503 });
    let payload: { plan?: string; charityId?: string; amount?: number };
    try { payload = await request.json(); } catch { return NextResponse.json({ error: "Invalid checkout request." }, { status: 400 }); }
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
    const returnUrl = appUrl(new URL(request.url).origin);
    const { data: existing, error: lookupError } = await db.from("subscriptions").select("stripe_customer_id").eq("user_id", user.id).not("stripe_customer_id", "is", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (lookupError) throw lookupError;
    const customer = existing?.stripe_customer_id;
    const identity = customer ? { customer } : { customer_email: user.email };
    if (payload.plan === "monthly" || payload.plan === "yearly") {
      if (customer) {
        const subs = await stripe.subscriptions.list({ customer, status: "all", limit: 100 });
        if (subs.data.some(item => ["active", "trialing", "past_due", "unpaid", "incomplete"].includes(item.status))) return NextResponse.json({ error: "You already have a membership. Use Manage billing in your dashboard to change or cancel it." }, { status: 409 });
      }
      const { data: choice, error } = await db.from("member_charities").select("charity_id,contribution_percent").eq("user_id", user.id).maybeSingle();
      if (error) throw error;
      if (!choice) return NextResponse.json({ error: "Choose and save a charity in your dashboard, then select your membership plan.", code: "CHARITY_REQUIRED" }, { status: 400 });
      const priceId = payload.plan === "monthly" ? process.env.STRIPE_MONTHLY_PRICE_ID : process.env.STRIPE_YEARLY_PRICE_ID;
      if (!priceId) return NextResponse.json({ error: "This sandbox membership price is not configured yet." }, { status: 503 });
      const price = await stripe.prices.retrieve(priceId);
      const plan = MEMBERSHIP_PLANS[payload.plan];
      if (!price.active || price.currency !== "inr" || price.unit_amount !== plan.amount * 100 || price.recurring?.interval !== plan.interval || price.recurring.interval_count !== 1) return NextResponse.json({ error: "The payment price does not match the advertised INR plan. Please contact support." }, { status: 503 });
      const session = await stripe.checkout.sessions.create({
        mode: "subscription", payment_method_types: ["card"], ...identity,
        line_items: [{ price: price.id, quantity: 1 }], client_reference_id: user.id,
        metadata: { user_id: user.id, plan: payload.plan }, subscription_data: { metadata: { user_id: user.id, plan: payload.plan } },
        success_url: returnUrl+"/dashboard?checkout=success", cancel_url: returnUrl+"/dashboard?checkout=cancelled",
      }, { idempotencyKey: "membership-"+user.id+"-"+payload.plan+"-"+Math.floor(Date.now()/600000) });
      return NextResponse.json({ url: session.url });
    }
    const amount = Number(payload.amount);
    if (!payload.charityId || !Number.isFinite(amount) || amount < 1 || amount > 10000 || Math.abs(amount*100-Math.round(amount*100)) > .00001) return NextResponse.json({ error: "Choose a charity and enter ₹1–₹10,000, with at most two decimal places." }, { status: 400 });
    const { data: charity, error } = await db.from("charities").select("id,name,slug").eq("id", payload.charityId).maybeSingle();
    if (error) throw error;
    if (!charity) return NextResponse.json({ error: "That charity is no longer available." }, { status: 404 });
    const session = await stripe.checkout.sessions.create({
      mode: "payment", payment_method_types: ["card"], ...identity, client_reference_id: user.id,
      line_items: [{ price_data: { currency: "inr", unit_amount: Math.round(amount*100), product_data: { name: "Independent donation to "+charity.name } }, quantity: 1 }],
      metadata: { type: "independent_donation", user_id: user.id, charity_id: charity.id },
      success_url: returnUrl+"/charities?donation=success", cancel_url: returnUrl+"/charities/"+charity.slug+"?donation=cancelled",
    });
    return NextResponse.json({ url: session.url });
  } catch { return NextResponse.json({ error: "Unable to start checkout. Please try again." }, { status: 502 }); }
}
