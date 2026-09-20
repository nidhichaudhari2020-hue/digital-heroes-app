# impact. interview project

## File structure

```text
impact-platform/
├─ app/                 # Next.js pages and global styles
│  ├─ admin/page.tsx    # Admin dashboard
│  ├─ dashboard/page.tsx# Member dashboard
│  └─ page.tsx          # Public landing page
├─ components/          # Client-side UI components
├─ lib/                 # Pure, testable business logic
│  ├─ scores.ts         # 1-45, duplicate-date, rolling-five rules
│  └─ draw.ts           # Draw simulation and prize calculations
├─ supabase/schema.sql  # Database schema and starter RLS policies
├─ .env.example         # Required secrets (never commit .env.local)
└─ package.json
```

## Run locally

```bash
npm install
copy .env.example .env.local
npm run dev
```

Open `http://localhost:3000`. The dashboard and admin screen use sample data until Supabase is connected.

## Connect Supabase

1. Create a new Supabase project and run `supabase/schema.sql` in the SQL editor.
2. Copy the project URL and anon key to `.env.local`.
3. Add Supabase Auth helpers, then replace the sample dashboard data with queries scoped to the signed-in user.
4. Add a database trigger to retain only the latest five scores; keep the UI validation as a second line of defence.

## Connect Stripe

Create Monthly and Yearly products. Add Checkout and webhook routes. Only the webhook should write subscription status, because it is the trusted Stripe event source.

## Assumption documented for reviewers

The PRD does not define the five draw numbers. This starter lets active members use five unique numbers from 1-45, while scores independently determine eligibility and provide the golf-performance feature. Record this choice in the final submission README.
