-- Run this ONCE in Supabase SQL Editor after schema.sql.
-- It adds production-ready access control, storage, indexes and seed content.

insert into public.charities (name, slug, description, is_featured) values
  ('Mind', 'mind', 'Mental health support and advocacy for everyone.', true),
  ('Shelter', 'shelter', 'Helping people find and keep a safe place to call home.', false),
  ('WWF', 'wwf', 'Protecting and restoring the natural world.', false)
on conflict (slug) do update set description = excluded.description;

insert into public.draws (label, status, mode, prize_pool, rollover_jackpot, draw_date)
values ('September 2026 draw', 'draft', 'random', 42800, 0, '2026-09-30 18:00:00+00')
on conflict (label) do nothing;

-- Preserve the charity picked during sign-up so the first successful
-- subscription can contribute to the member's chosen cause immediately.
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

create index if not exists scores_user_date_idx on public.scores (user_id, score_date desc);
create index if not exists subscriptions_user_created_idx on public.subscriptions (user_id, created_at desc);
create index if not exists winners_user_status_idx on public.winners (user_id, payout_status);
create index if not exists draws_status_date_idx on public.draws (status, draw_date);
alter table public.donations add column if not exists stripe_payment_id text unique;

create or replace function public.is_active_member() returns boolean language sql stable security definer set search_path = public as $$
  select exists(
    select 1 from public.subscriptions
    where user_id = auth.uid()
      and status = 'active'
      and (current_period_end is null or current_period_end > now())
  )
$$;

-- Members may update their display name, but must never be able to elevate
-- their own role through the otherwise valid self-update policy.
create or replace function public.prevent_profile_role_escalation()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.role is distinct from old.role
    and current_user not in ('postgres', 'supabase_admin', 'service_role')
    and not public.is_admin() then
    raise exception 'Only an administrator can change a member role';
  end if;
  return new;
end;
$$;
drop trigger if exists prevent_profile_role_escalation on public.profiles;
create trigger prevent_profile_role_escalation
before update of role on public.profiles
for each row execute function public.prevent_profile_role_escalation();

-- Do not expose a broad profile UPDATE policy. Members can change only their
-- display name through this narrow function; role changes remain administrative.
drop policy if exists "profile self update" on public.profiles;
create or replace function public.update_profile_name(p_full_name text)
returns public.profiles language plpgsql security definer set search_path = public as $$
declare updated_profile public.profiles;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  if char_length(trim(p_full_name)) not between 2 and 100 then
    raise exception 'Full name must be between 2 and 100 characters';
  end if;
  update public.profiles set full_name = trim(p_full_name) where id = auth.uid() returning * into updated_profile;
  return updated_profile;
end;
$$;
revoke all on function public.update_profile_name(text) from public;
grant execute on function public.update_profile_name(text) to authenticated;

create or replace function public.can_enter_draw(p_draw_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_active_member()
    and (select count(*) from public.scores where user_id = auth.uid()) = 5
    and exists(
      select 1 from public.draws
      where id = p_draw_id and status = 'draft' and draw_date > now()
    )
$$;

-- The RLS policy gives a fast early rejection. This trigger is the final
-- gate: it locks the parent draw so an entry cannot slip in after the
-- publisher has counted entries but before the status change commits.
create or replace function public.guard_draw_entry_write()
returns trigger language plpgsql security definer set search_path = public as $$
declare current_draw public.draws;
begin
  if auth.uid() is null or new.user_id <> auth.uid() then
    raise exception 'You can only manage your own draw entry';
  end if;
  if tg_op = 'UPDATE' and new.draw_id is distinct from old.draw_id then
    raise exception 'A saved draw entry cannot be moved to another draw';
  end if;
  if not public.is_active_member() then
    raise exception 'An active membership is required to enter a draw';
  end if;
  if (select count(*) from public.scores where user_id = auth.uid()) <> 5 then
    raise exception 'Five recent scores are required to enter a draw';
  end if;
  select * into current_draw from public.draws where id = new.draw_id for update;
  if not found or current_draw.status <> 'draft' or current_draw.draw_date <= now() then
    raise exception 'This draw is no longer open for entries';
  end if;
  return new;
end;
$$;
drop trigger if exists guard_draw_entry_write on public.draw_entries;
create trigger guard_draw_entry_write
before insert or update on public.draw_entries
for each row execute function public.guard_draw_entry_write();

drop policy if exists "own scores" on public.scores;
drop policy if exists "scores select own" on public.scores;
drop policy if exists "scores insert active member" on public.scores;
drop policy if exists "scores update active member" on public.scores;
drop policy if exists "scores delete active member" on public.scores;
create policy "scores select own" on public.scores for select using (auth.uid() = user_id);
create policy "scores insert active member" on public.scores for insert with check (auth.uid() = user_id and public.is_active_member());
create policy "scores update active member" on public.scores for update using (auth.uid() = user_id and public.is_active_member()) with check (auth.uid() = user_id and public.is_active_member());
create policy "scores delete active member" on public.scores for delete using (auth.uid() = user_id and public.is_active_member());

drop policy if exists "own charity" on public.member_charities;
drop policy if exists "charity choice select own" on public.member_charities;
drop policy if exists "charity choice insert active member" on public.member_charities;
drop policy if exists "charity choice update active member" on public.member_charities;
create policy "charity choice select own" on public.member_charities for select using (auth.uid() = user_id);
create policy "charity choice insert active member" on public.member_charities for insert with check (auth.uid() = user_id and public.is_active_member());
create policy "charity choice update active member" on public.member_charities for update using (auth.uid() = user_id and public.is_active_member()) with check (auth.uid() = user_id and public.is_active_member());

drop policy if exists "draw entry insert active member" on public.draw_entries;
drop policy if exists "draw entry update active member" on public.draw_entries;
create policy "draw entry insert active member" on public.draw_entries for insert with check (
  auth.uid() = user_id and public.can_enter_draw(draw_id)
);
create policy "draw entry update active member" on public.draw_entries for update using (
  auth.uid() = user_id and public.can_enter_draw(draw_id)
) with check (
  auth.uid() = user_id and public.can_enter_draw(draw_id)
);

-- A draft is the open, pre-publication draw. Active members need to see it in
-- order to submit an entry; published results remain publicly readable.
drop policy if exists "active members view draft draws" on public.draws;
create policy "active members view draft draws" on public.draws for select using (
  status = 'draft' and draw_date > now() and public.is_active_member()
);

-- PostgreSQL CHECK constraints cannot contain subqueries, so put the reusable
-- 1–45 / unique-five validation in an immutable helper first.
create or replace function public.valid_draw_numbers(p_numbers smallint[])
returns boolean language sql immutable set search_path = public as $$
  select coalesce(
    cardinality(p_numbers) = 5
    and (select count(*) from unnest(p_numbers) as number(value) where value between 1 and 45) = 5
    and (select count(distinct value) from unnest(p_numbers) as number(value)) = 5,
    false
  )
$$;

alter table public.draw_entries drop constraint if exists valid_draw_entry_numbers;
alter table public.draw_entries add constraint valid_draw_entry_numbers check (public.valid_draw_numbers(numbers));
alter table public.draws drop constraint if exists valid_winning_numbers;
alter table public.draws add constraint valid_winning_numbers check (winning_numbers is null or public.valid_draw_numbers(winning_numbers));

-- There can be only one open monthly draw. A new draft automatically receives
-- the unclaimed five-match jackpot from the most recent published draw.
create or replace function public.create_draw(p_label text, p_mode text, p_draw_date timestamptz, p_prize_pool numeric)
returns public.draws language plpgsql security definer set search_path = public as $$
declare created_draw public.draws;
declare carried_jackpot numeric(12,2) := 0;
declare active_member_count integer := 0;
declare automatic_prize_pool numeric(12,2) := 0;
begin
  if not public.is_admin() then raise exception 'Administrator access is required to create a draw'; end if;
  if char_length(trim(p_label)) < 3 then raise exception 'Draw label must be at least 3 characters'; end if;
  if p_mode not in ('random', 'algorithmic') then raise exception 'Draw mode must be random or algorithmic'; end if;
  if p_draw_date <= now() then raise exception 'Draw date must be in the future'; end if;
  if coalesce(p_prize_pool, 0) < 0 then raise exception 'Prize pool top-up cannot be negative'; end if;
  if exists(select 1 from public.draws where status = 'draft') then
    raise exception 'Publish or close the existing open draw before creating another';
  end if;
  -- The fixed ₹100 contribution per active subscriber is calculated on the
  -- database side so the browser cannot understate a draw's base pool. The
  -- final argument is an optional administrator-approved bonus top-up.
  select count(distinct user_id) into active_member_count
  from public.subscriptions
  where status = 'active' and (current_period_end is null or current_period_end > now());
  automatic_prize_pool := active_member_count * 100;
  select coalesce(rollover_jackpot, 0) into carried_jackpot
  from public.draws where status in ('published', 'closed') order by draw_date desc limit 1;
  insert into public.draws (label, status, mode, prize_pool, rollover_jackpot, draw_date)
  values (trim(p_label), 'draft', p_mode, automatic_prize_pool + coalesce(p_prize_pool, 0), coalesce(carried_jackpot, 0), p_draw_date)
  returning * into created_draw;
  return created_draw;
end;
$$;
revoke all on function public.create_draw(text, text, timestamptz, numeric) from public;
grant execute on function public.create_draw(text, text, timestamptz, numeric) to authenticated;

-- Publish through one transaction, rather than allowing browser code to write
-- results and winners separately. This locks the draft, calculates all tiers,
-- rolls an unclaimed five-match pool forward, and is safe to call only once.
create or replace function public.publish_draw(p_draw_id uuid, p_winning_numbers smallint[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  current_draw public.draws;
  entry_row record;
  matched integer;
  five_count integer := 0;
  four_count integer := 0;
  three_count integer := 0;
  winner_count integer := 0;
  five_share numeric(12,2) := 0;
  four_share numeric(12,2) := 0;
  three_share numeric(12,2) := 0;
  next_jackpot numeric(12,2) := 0;
begin
  if not public.is_admin() then
    raise exception 'Administrator access is required to publish a draw';
  end if;
  if not public.valid_draw_numbers(p_winning_numbers) then
    raise exception 'A draw must contain five unique numbers from 1 to 45';
  end if;

  select * into current_draw from public.draws where id = p_draw_id for update;
  if not found then
    raise exception 'Draw not found';
  end if;
  if current_draw.status <> 'draft' then
    raise exception 'Only a draft draw can be published';
  end if;

  for entry_row in select user_id, numbers from public.draw_entries where draw_id = p_draw_id loop
    select count(*) into matched from unnest(entry_row.numbers) as number(value) where value = any(p_winning_numbers);
    if matched = 5 then five_count := five_count + 1;
    elsif matched = 4 then four_count := four_count + 1;
    elsif matched = 3 then three_count := three_count + 1;
    end if;
  end loop;

  five_share := case when five_count > 0 then (current_draw.prize_pool * .40 + current_draw.rollover_jackpot) / five_count else 0 end;
  four_share := case when four_count > 0 then (current_draw.prize_pool * .35) / four_count else 0 end;
  three_share := case when three_count > 0 then (current_draw.prize_pool * .25) / three_count else 0 end;
  next_jackpot := case when five_count = 0 then current_draw.prize_pool * .40 + current_draw.rollover_jackpot else 0 end;

  for entry_row in select user_id, numbers from public.draw_entries where draw_id = p_draw_id loop
    select count(*) into matched from unnest(entry_row.numbers) as number(value) where value = any(p_winning_numbers);
    if matched >= 3 then
      insert into public.winners (draw_id, user_id, match_count, prize_amount, payout_status)
      values (
        p_draw_id,
        entry_row.user_id,
        matched,
        case matched when 5 then five_share when 4 then four_share else three_share end,
        'pending_proof'
      )
      on conflict (draw_id, user_id) do update set
        match_count = excluded.match_count,
        prize_amount = excluded.prize_amount,
        payout_status = 'pending_proof',
        proof_url = null,
        reviewed_by = null,
        reviewed_at = null;
      winner_count := winner_count + 1;
    end if;
  end loop;

  update public.draws
  set status = 'published', winning_numbers = p_winning_numbers, rollover_jackpot = next_jackpot
  where id = p_draw_id;

  return jsonb_build_object(
    'winner_count', winner_count,
    'five_match_winners', five_count,
    'four_match_winners', four_count,
    'three_match_winners', three_count,
    'next_jackpot', next_jackpot
  );
end;
$$;
revoke all on function public.publish_draw(uuid, smallint[]) from public;
grant execute on function public.publish_draw(uuid, smallint[]) to authenticated;

create or replace function public.review_winner(p_winner_id uuid, p_status public.payout_status)
returns public.winners language plpgsql security definer set search_path = public as $$
declare current_winner public.winners;
declare updated_winner public.winners;
begin
  if not public.is_admin() then
    raise exception 'Administrator access is required to review a winner';
  end if;
  select * into current_winner from public.winners where id = p_winner_id for update;
  if not found then
    raise exception 'Winner record not found';
  end if;
  if (current_winner.payout_status = 'pending_proof' and p_status not in ('pending_proof','under_review','rejected'))
    or (current_winner.payout_status = 'under_review' and p_status not in ('under_review','approved','rejected'))
    or (current_winner.payout_status = 'approved' and p_status not in ('approved','paid','rejected'))
    or (current_winner.payout_status = 'rejected' and p_status not in ('rejected','under_review'))
    or (current_winner.payout_status = 'paid' and p_status <> 'paid') then
    raise exception 'That payout status transition is not allowed';
  end if;
  if current_winner.payout_status = 'pending_proof' and p_status = 'under_review' and current_winner.proof_url is null then
    raise exception 'A proof file is required before a winner can be reviewed';
  end if;
  update public.winners
  set payout_status = p_status, reviewed_by = auth.uid(), reviewed_at = now()
  where id = p_winner_id
  returning * into updated_winner;
  return updated_winner;
end;
$$;
revoke all on function public.review_winner(uuid, public.payout_status) from public;
grant execute on function public.review_winner(uuid, public.payout_status) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('winner-proofs', 'winner-proofs', false, 5242880, array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do nothing;

create policy "winner proof upload own folder" on storage.objects for insert to authenticated with check (
  bucket_id = 'winner-proofs' and (storage.foldername(name))[1] = auth.uid()::text
);
create policy "winner proof view own folder" on storage.objects for select to authenticated using (
  bucket_id = 'winner-proofs' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
);

create or replace function public.submit_winner_proof(p_winner_id uuid, p_proof_url text)
returns public.winners language plpgsql security definer set search_path = public as $$
declare updated_winner public.winners;
begin
  if not exists(select 1 from public.winners where id = p_winner_id and user_id = auth.uid() and payout_status = 'pending_proof') then
    raise exception 'Winner proof cannot be submitted for this record';
  end if;
  if position('/' in p_proof_url) = 0 or split_part(p_proof_url, '/', 1) <> auth.uid()::text then
    raise exception 'Winner proof must be stored in your private proof folder';
  end if;
  if not exists(select 1 from storage.objects where bucket_id = 'winner-proofs' and name = p_proof_url) then
    raise exception 'Upload the proof file before submitting it for review';
  end if;
  update public.winners set proof_url = p_proof_url, payout_status = 'under_review' where id = p_winner_id returning * into updated_winner;
  return updated_winner;
end;
$$;
revoke all on function public.submit_winner_proof(uuid, text) from public;
grant execute on function public.submit_winner_proof(uuid, text) to authenticated;

create table if not exists public.charity_events (
  id uuid primary key default gen_random_uuid(),
  charity_id uuid not null references public.charities on delete cascade,
  title text not null,
  event_date date,
  location text,
  description text,
  created_at timestamptz not null default now()
);
alter table public.charity_events enable row level security;
create policy "public charity events" on public.charity_events for select using (true);
create policy "admin charity events" on public.charity_events for all using (public.is_admin()) with check (public.is_admin());
