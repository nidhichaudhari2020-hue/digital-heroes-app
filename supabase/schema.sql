create type public.user_role as enum ('member','admin');
create type public.subscription_status as enum ('active','cancelled','past_due','lapsed');
create type public.draw_status as enum ('draft','published','closed');
create type public.payout_status as enum ('pending_proof','under_review','approved','rejected','paid');

create table public.profiles (id uuid primary key references auth.users on delete cascade, full_name text not null, role public.user_role not null default 'member', created_at timestamptz not null default now());
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name) values (new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)));
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();
create table public.charities (id uuid primary key default gen_random_uuid(), name text not null, slug text unique not null, description text not null, image_url text, is_featured boolean not null default false, created_at timestamptz not null default now());
create table public.subscriptions (id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles on delete cascade, stripe_customer_id text unique, stripe_subscription_id text unique, plan text not null check(plan in ('monthly','yearly')), status public.subscription_status not null, current_period_end timestamptz, created_at timestamptz not null default now());
create table public.member_charities (user_id uuid primary key references public.profiles on delete cascade, charity_id uuid not null references public.charities, contribution_percent numeric(5,2) not null check(contribution_percent >= 10 and contribution_percent <= 100), updated_at timestamptz not null default now());
create table public.scores (id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles on delete cascade, score_date date not null, stableford_points smallint not null check(stableford_points between 1 and 45), created_at timestamptz not null default now(), unique(user_id,score_date));
create table public.draws (id uuid primary key default gen_random_uuid(), label text not null unique, status public.draw_status not null default 'draft', mode text not null check(mode in ('random','algorithmic')), winning_numbers smallint[] check(cardinality(winning_numbers)=5), prize_pool numeric(12,2) not null default 0, rollover_jackpot numeric(12,2) not null default 0, draw_date timestamptz not null, created_at timestamptz not null default now());
create table public.draw_entries (id uuid primary key default gen_random_uuid(), draw_id uuid not null references public.draws on delete cascade, user_id uuid not null references public.profiles on delete cascade, numbers smallint[] not null check(cardinality(numbers)=5), unique(draw_id,user_id));
create table public.winners (id uuid primary key default gen_random_uuid(), draw_id uuid not null references public.draws, user_id uuid not null references public.profiles, match_count smallint not null check(match_count between 3 and 5), prize_amount numeric(12,2) not null default 0, proof_url text, payout_status public.payout_status not null default 'pending_proof', reviewed_by uuid references public.profiles, reviewed_at timestamptz, created_at timestamptz not null default now(), unique(draw_id,user_id));
create table public.donations (id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles, charity_id uuid not null references public.charities, subscription_id uuid references public.subscriptions, amount numeric(12,2) not null check(amount>0), created_at timestamptz not null default now());

alter table public.profiles enable row level security; alter table public.scores enable row level security; alter table public.member_charities enable row level security;
alter table public.charities enable row level security; alter table public.subscriptions enable row level security; alter table public.draws enable row level security; alter table public.draw_entries enable row level security; alter table public.winners enable row level security; alter table public.donations enable row level security;
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path = public as $$ select exists(select 1 from public.profiles where id=auth.uid() and role='admin') $$;
create policy "profile self read" on public.profiles for select using(auth.uid()=id); create policy "profile self update" on public.profiles for update using(auth.uid()=id);
create policy "own scores" on public.scores for all using(auth.uid()=user_id) with check(auth.uid()=user_id);
create policy "own charity" on public.member_charities for all using(auth.uid()=user_id) with check(auth.uid()=user_id);
create policy "public charities" on public.charities for select using(true);
create policy "own subscription read" on public.subscriptions for select using(auth.uid()=user_id);
create policy "published draws read" on public.draws for select using(status='published');
create policy "own draw entry" on public.draw_entries for select using(auth.uid()=user_id);
create policy "own winner read" on public.winners for select using(auth.uid()=user_id);
create policy "own donation read" on public.donations for select using(auth.uid()=user_id);
create policy "admin profiles" on public.profiles for all using(public.is_admin()) with check(public.is_admin());
create policy "admin scores" on public.scores for all using(public.is_admin()) with check(public.is_admin());
create policy "admin charities" on public.charities for all using(public.is_admin()) with check(public.is_admin());
create policy "admin subscriptions" on public.subscriptions for all using(public.is_admin()) with check(public.is_admin());
create policy "admin choices" on public.member_charities for all using(public.is_admin()) with check(public.is_admin());
create policy "admin draws" on public.draws for all using(public.is_admin()) with check(public.is_admin());
create policy "admin entries" on public.draw_entries for all using(public.is_admin()) with check(public.is_admin());
create policy "admin winners" on public.winners for all using(public.is_admin()) with check(public.is_admin());
create policy "admin donations" on public.donations for all using(public.is_admin()) with check(public.is_admin());

-- The UI validates this too, but the database is the authoritative guardrail.
create or replace function public.retain_latest_five_scores() returns trigger language plpgsql security definer as $$
begin
  delete from public.scores
  where id in (
    select id from public.scores where user_id = new.user_id
    order by score_date desc, created_at desc offset 5
  );
  return new;
end;
$$;
create trigger retain_latest_five_scores_after_write
after insert or update of score_date on public.scores
for each row execute function public.retain_latest_five_scores();

-- Draw publication, prize calculation, winner verification, and payouts run only
-- through server-side admin routes using the service role; never expose that key.
