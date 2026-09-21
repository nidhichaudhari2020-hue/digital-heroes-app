create type public.user_role as enum ('member','admin');
create type public.subscription_status as enum ('active','cancelled','past_due','lapsed');
create type public.draw_status as enum ('draft','published','closed');
create type public.payout_status as enum ('pending_proof','under_review','approved','rejected','paid');

create or replace function public.valid_draw_numbers(p_numbers smallint[]) returns boolean language sql immutable set search_path = public as $$
  select coalesce(
    cardinality(p_numbers) = 5
    and (select count(*) from unnest(p_numbers) as number(value) where value between 1 and 45) = 5
    and (select count(distinct value) from unnest(p_numbers) as number(value)) = 5,
    false
  )
$$;

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
create table public.draws (id uuid primary key default gen_random_uuid(), label text not null unique, status public.draw_status not null default 'draft', mode text not null check(mode in ('random','algorithmic')), winning_numbers smallint[] check(winning_numbers is null or public.valid_draw_numbers(winning_numbers)), prize_pool numeric(12,2) not null default 0, rollover_jackpot numeric(12,2) not null default 0, draw_date timestamptz not null, created_at timestamptz not null default now());
create table public.draw_entries (id uuid primary key default gen_random_uuid(), draw_id uuid not null references public.draws on delete cascade, user_id uuid not null references public.profiles on delete cascade, numbers smallint[] not null check(public.valid_draw_numbers(numbers)), unique(draw_id,user_id));
create table public.winners (id uuid primary key default gen_random_uuid(), draw_id uuid not null references public.draws, user_id uuid not null references public.profiles, match_count smallint not null check(match_count between 3 and 5), prize_amount numeric(12,2) not null default 0, proof_url text, payout_status public.payout_status not null default 'pending_proof', reviewed_by uuid references public.profiles, reviewed_at timestamptz, created_at timestamptz not null default now(), unique(draw_id,user_id));
create table public.donations (id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles, charity_id uuid not null references public.charities, subscription_id uuid references public.subscriptions, amount numeric(12,2) not null check(amount>0), stripe_payment_id text unique, created_at timestamptz not null default now());

-- A subscriber can choose a cause during account creation. The auth trigger
-- stores this preference even before checkout; feature access remains gated by
-- the active-subscription policies below.
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
declare selected_charity uuid;
declare selected_percent numeric(5,2);
begin
  insert into public.profiles (id, full_name) values (new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)));
  if coalesce(new.raw_user_meta_data->>'charity_id', '') ~ '^[0-9a-fA-F-]{36}$' then
    selected_charity := (new.raw_user_meta_data->>'charity_id')::uuid;
    selected_percent := case when coalesce(new.raw_user_meta_data->>'contribution_percent', '') ~ '^[0-9]+(\.[0-9]+)?$'
      then least(100::numeric, greatest(10::numeric, (new.raw_user_meta_data->>'contribution_percent')::numeric)) else 10 end;
    if exists(select 1 from public.charities where id = selected_charity) then
      insert into public.member_charities (user_id, charity_id, contribution_percent)
      values (new.id, selected_charity, selected_percent)
      on conflict (user_id) do update set charity_id = excluded.charity_id, contribution_percent = excluded.contribution_percent, updated_at = now();
    end if;
  end if;
  return new;
end;
$$;

alter table public.profiles enable row level security; alter table public.scores enable row level security; alter table public.member_charities enable row level security;
alter table public.charities enable row level security; alter table public.subscriptions enable row level security; alter table public.draws enable row level security; alter table public.draw_entries enable row level security; alter table public.winners enable row level security; alter table public.donations enable row level security;
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path = public as $$ select exists(select 1 from public.profiles where id=auth.uid() and role='admin') $$;
create or replace function public.is_active_member() returns boolean language sql stable security definer set search_path = public as $$ select exists(select 1 from public.subscriptions where user_id=auth.uid() and status='active' and (current_period_end is null or current_period_end>now())) $$;
create or replace function public.prevent_profile_role_escalation() returns trigger language plpgsql set search_path = public as $$
begin
  if new.role is distinct from old.role and current_user not in ('postgres','supabase_admin','service_role') and not public.is_admin() then
    raise exception 'Only an administrator can change a member role';
  end if;
  return new;
end;
$$;
create trigger prevent_profile_role_escalation before update of role on public.profiles for each row execute function public.prevent_profile_role_escalation();
create or replace function public.update_profile_name(p_full_name text) returns public.profiles language plpgsql security definer set search_path = public as $$
declare updated_profile public.profiles;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  if char_length(trim(p_full_name)) not between 2 and 100 then raise exception 'Full name must be between 2 and 100 characters'; end if;
  update public.profiles set full_name=trim(p_full_name) where id=auth.uid() returning * into updated_profile;
  return updated_profile;
end;
$$;
revoke all on function public.update_profile_name(text) from public; grant execute on function public.update_profile_name(text) to authenticated;
create or replace function public.can_enter_draw(p_draw_id uuid) returns boolean language sql stable security definer set search_path = public as $$
  select public.is_active_member() and (select count(*) from public.scores where user_id=auth.uid())=5 and exists(select 1 from public.draws where id=p_draw_id and status='draft' and draw_date>now())
$$;
create policy "profile self read" on public.profiles for select using(auth.uid()=id);
create policy "scores select own" on public.scores for select using(auth.uid()=user_id);
create policy "scores insert active member" on public.scores for insert with check(auth.uid()=user_id and public.is_active_member());
create policy "scores update active member" on public.scores for update using(auth.uid()=user_id and public.is_active_member()) with check(auth.uid()=user_id and public.is_active_member());
create policy "scores delete active member" on public.scores for delete using(auth.uid()=user_id and public.is_active_member());
create policy "charity choice select own" on public.member_charities for select using(auth.uid()=user_id);
create policy "charity choice insert active member" on public.member_charities for insert with check(auth.uid()=user_id and public.is_active_member());
create policy "charity choice update active member" on public.member_charities for update using(auth.uid()=user_id and public.is_active_member()) with check(auth.uid()=user_id and public.is_active_member());
create policy "public charities" on public.charities for select using(true);
create policy "own subscription read" on public.subscriptions for select using(auth.uid()=user_id);
create policy "published draws read" on public.draws for select using(status='published');
create policy "active members view draft draws" on public.draws for select using(status='draft' and draw_date>now() and public.is_active_member());
create policy "own draw entry" on public.draw_entries for select using(auth.uid()=user_id);
create policy "draw entry insert active member" on public.draw_entries for insert with check(auth.uid()=user_id and public.can_enter_draw(draw_id));
create policy "draw entry update active member" on public.draw_entries for update using(auth.uid()=user_id and public.can_enter_draw(draw_id)) with check(auth.uid()=user_id and public.can_enter_draw(draw_id));
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
