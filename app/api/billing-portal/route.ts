import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@/lib/supabase/server";
import { appUrl, billingConfigured } from "@/lib/billing";
export async function POST(request: Request) {
  if (request.headers.get("origin") && request.headers.get("origin") !== new URL(request.url).origin) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  try {
    const db = await createClient();
    const { data: { user } } = await db.auth.getUser();
    if (!user) return NextResponse.json({ error: "Please log in first." }, { status: 401 });
    if (!billingConfigured()) return NextResponse.json({ error: "Sandbox billing has not been configured yet." }, { status: 503 });
    const { data, error } = await db.from("subscriptions").select("stripe_customer_id").eq("user_id", user.id).not("stripe_customer_id", "is", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    if (!data?.stripe_customer_id) return NextResponse.json({ error: "This evaluation membership has no Stripe billing account." }, { status: 404 });
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
    const portal = await stripe.billingPortal.sessions.create({ customer: data.stripe_customer_id, return_url: `${appUrl(new URL(request.url).origin)}/dashboard` });
    return NextResponse.json({ url: portal.url });
  } catch { return NextResponse.json({ error: "The billing portal is unavailable. Please ask the administrator to activate it in Stripe test mode." }, { status: 502 }); }
}
