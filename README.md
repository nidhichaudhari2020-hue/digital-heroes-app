# impact. - Digital Heroes assignment

A charity-led golf membership platform built for the Digital Heroes full-stack selection assignment. Members track their five latest Stableford scores, choose a charity contribution, enter monthly draws, and verify prize claims. All customer-facing amounts are Indian rupees (INR). Administrators manage users, charity content, draws, results, reports, and payout progress.

## Live application

`https://digital-heroes-app-one.vercel.app`

## Product coverage

- Public marketing site, draw explainer, searchable charity directory, and charity profiles/events
- Supabase email/password authentication with a confirmation callback
- ₹299/month and ₹2,999/year membership Checkout, INR independent charity donations, and idempotent Stripe webhook ledger updates
- Authenticated member dashboard: membership state, profile settings, charity percentage, score add/edit/delete, rolling-five logic, draw entry/history, donation ledger, winnings, and proof upload
- Administrator control room: users/profile editing, score editing, subscription support, draw creation/simulation/publication, charity/media/event CRUD, verification queue, payout status, reports, and analytics
- Supabase RLS policies, storage rules, score retention trigger, and review-safe winner proof RPC

## Role boundaries

| Role | Allowed experience |
| --- | --- |
| Public visitor | Browse the platform story, draw rules, featured charities, directory search/filter, charity profiles, images, and events; begin the membership flow. |
| Registered subscriber | Manage profile settings, active membership, five rolling scores, charity selection/contribution, draw entries/history, impact ledger, winnings, and proof uploads. Database policies independently enforce active membership for restricted actions. |
| Administrator | Manage member profiles, scores, subscription support, draw configuration/simulation/publication, charities/media/events, winner verification/payouts, and reports. |

## Tech stack

- Next.js App Router + TypeScript
- Supabase Auth, Postgres, Row Level Security, and Storage
- Stripe Checkout + webhooks
- Vercel deployment

## Local development

```bash
npm install
copy .env.example .env.local
npm run dev
```

Open `http://localhost:3000` (or the alternate port shown by Next.js).

## Environment variables

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-publishable-key
SUPABASE_SERVICE_ROLE_KEY=server-only-secret
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
# Create INR prices: ₹299 monthly and ₹2,999 yearly.
STRIPE_MONTHLY_PRICE_ID=price_...
STRIPE_YEARLY_PRICE_ID=price_...
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

Never commit `.env.local`, Stripe secret keys, or the Supabase service-role key.

## Supabase setup

1. In a new Supabase project, run `supabase/schema.sql` in SQL Editor.
2. Then run `supabase/production-upgrade.sql` once. This is required: it seeds the directory, creates the storage bucket, and installs the secure draw, eligibility, proof-review, and payout functions.
3. In **Authentication → URL Configuration**, add:

```text
http://localhost:3000/auth/callback
https://digital-heroes-app-one.vercel.app/auth/callback
```

4. Set the production Site URL to `https://digital-heroes-app-one.vercel.app`.
5. Create a member through `/auth`, then make your admin using SQL:

```sql
update public.profiles
set role = 'admin'
where id = (select id from auth.users where email = 'your-admin-email@example.com');
```

## Stripe test-mode setup

1. Create INR recurring Stripe prices: **₹299/month** and **₹2,999/year**. Use the returned price IDs below; do not use prices in another currency.
2. Add their IDs to the Vercel and local environment variables.
3. Add `STRIPE_SECRET_KEY` and the Supabase service-role key only to secure server environments.
4. Configure a Stripe webhook to `/api/stripe-webhook`, subscribe it to `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, and `checkout.session.completed`, then copy its signing secret.
5. Use Stripe test cards only for the assignment demo.

## Business assumptions

The PRD deliberately leaves several details unspecified. This implementation documents the following decisions:

- Members select five unique draw numbers from 1 to 45; golf scores independently supply the performance-tracking feature and draw eligibility requirement.
- Members need an active subscription and five stored scores to submit or update a draw entry.
- The public plan catalogue is ₹299/month or ₹2,999/year. Stripe remains the payment source of truth, so its recurring INR prices must match those displayed amounts.
- Each active subscription contributes a fixed ₹100 to the monthly prize pool. The database calculates this base pool at draw creation; an administrator may only add a non-negative bonus top-up.
- The administrator chooses `random` or `algorithmic` draw mode. Algorithmic mode applies a transparent weighted selection: each value from 1–45 has a base weight of one plus its frequency across recorded Stableford scores, with no number selected twice.
- Five-match prizes roll into the next draw when there is no five-match winner; prizes are split equally within each tier.
- A `draft` draw is the open entry period. The database—not just the UI—requires an active, unexpired member, exactly five retained scores, a future draw date, and five valid unique numbers before an entry can be saved.

## Verification checklist

- [ ] New user can sign up, confirm email, and log in on the production URL.
- [ ] Member can select a charity contribution of 10% or more.
- [ ] Member can update profile settings and see participation and impact-ledger history.
- [ ] Active member can add, edit, and delete scores; only five newest are retained.
- [ ] Active eligible member can save five draw numbers.
- [ ] Admin can create, simulate, and publish a draw.
- [ ] Winner can upload proof; admin can change review/payout status.
- [ ] Admin can edit member profiles/scores, manage charity content/events, and read the reports surface.
- [ ] Stripe test checkout writes `active`, `past_due`, `cancelled`, or `lapsed` subscription status through the webhook, and successful payments add an idempotent donation ledger record.

## Deployment

Push to `main` and Vercel automatically builds and deploys the app. Add production environment variables in Vercel before deploying changes that depend on Supabase or Stripe.
