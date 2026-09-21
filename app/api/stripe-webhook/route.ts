import { NextResponse } from "next/server";
import Stripe from "stripe";
import { adminDb } from "@/lib/supabase/admin";
import { billingConfigured } from "@/lib/billing";
import { processBillingEvent } from "@/lib/billing-webhook";

export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!billingConfigured() || !secret || secret.includes("...")) return NextResponse.json({ error: "Sandbox billing is not configured." }, { status: 503 });
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
  let event: Stripe.Event;
  try { event = stripe.webhooks.constructEvent(await request.text(), request.headers.get("stripe-signature") || "", secret); }
  catch { return NextResponse.json({ error: "Invalid webhook signature" }, { status: 400 }); }
  try {
    await processBillingEvent(event, stripe, adminDb());
    return NextResponse.json({ received: true });
  } catch {
    console.error("Billing event processing failed", { eventId: event.id, type: event.type });
    return NextResponse.json({ error: "Event could not be persisted; retry required." }, { status: 500 });
  }
}
