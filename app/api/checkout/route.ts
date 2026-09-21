import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@/lib/supabase/server";

const appUrl = () => process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please log in first." }, { status: 401 });

  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: "Stripe has not been configured yet." }, { status: 503 });
  }

  let payload: { plan?: string; charityId?: string; amount?: number };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid checkout request." }, { status: 400 });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const customerEmail = user.email || undefined;

  if (payload.plan === "monthly" || payload.plan === "yearly") {
    const price = payload.plan === "monthly" ? process.env.STRIPE_MONTHLY_PRICE_ID : process.env.STRIPE_YEARLY_PRICE_ID;
    if (!price) return NextResponse.json({ error: "This membership plan has not been configured yet." }, { status: 503 });
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [{ price, quantity: 1 }],
      client_reference_id: user.id,
      customer_email: customerEmail,
      metadata: { user_id: user.id, plan: payload.plan },
      subscription_data: { metadata: { user_id: user.id, plan: payload.plan } },
      success_url: `${appUrl()}/dashboard?checkout=success`,
      cancel_url: `${appUrl()}/dashboard?checkout=cancelled`,
    });
    return NextResponse.json({ url: session.url });
  }

  const amount = Number(payload.amount);
  if (!payload.charityId || !Number.isFinite(amount) || amount < 1 || amount > 10000) {
    return NextResponse.json({ error: "Choose a charity and enter a donation from ₹1 to ₹10,000." }, { status: 400 });
  }
  const { data: charity } = await supabase.from("charities").select("id,name,slug").eq("id", payload.charityId).maybeSingle();
  if (!charity) return NextResponse.json({ error: "That charity is no longer available." }, { status: 404 });

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
    line_items: [{
      price_data: {
        currency: "inr",
        unit_amount: Math.round(amount * 100),
        product_data: { name: `Independent donation to ${charity.name}` },
      },
      quantity: 1,
    }],
    client_reference_id: user.id,
    customer_email: customerEmail,
    metadata: { type: "independent_donation", user_id: user.id, charity_id: charity.id },
    success_url: `${appUrl()}/charities?donation=success`,
    cancel_url: `${appUrl()}/charities/${charity.slug}?donation=cancelled`,
  });
  return NextResponse.json({ url: session.url });
}
