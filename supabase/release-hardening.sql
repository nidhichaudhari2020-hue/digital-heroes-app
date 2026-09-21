-- Apply AFTER production-upgrade.sql. Rerunnable; no member data is deleted.
begin;
alter table public.subscriptions add column if not exists cancel_at_period_end boolean not null default false;
alter table public.subscriptions drop constraint if exists subscriptions_stripe_customer_id_key;
create index if not exists subscriptions_customer_idx on public.subscriptions(stripe_customer_id);
alter table public.draws add column if not exists jackpot_in numeric(12,2) not null default 0;
alter table public.draws add column if not exists rounding_reserve numeric(12,2) not null default 0;

create or replace function public.is_active_member() returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.subscriptions where user_id=auth.uid() and status='active' and current_period_end>now())
$$;

-- Serialize score writes for a member before trimming the rolling window.
create or replace function public.guard_score_write() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.score_date > current_date then raise exception 'A golf score cannot be in the future'; end if;
  if tg_op='UPDATE' and new.user_id<>old.user_id then raise exception 'Score ownership cannot be changed'; end if;
  perform 1 from public.profiles where id=new.user_id for update;
  return new;
end; $$;
drop trigger if exists guard_score_write on public.scores;
create trigger guard_score_write before insert or update on public.scores for each row execute function public.guard_score_write();

create or replace function public.create_draw(p_label text,p_mode text,p_draw_date timestamptz,p_prize_pool numeric)
returns public.draws language plpgsql security definer set search_path=public as $$
declare result public.draws; carried numeric:=0; members integer;
begin
  if not public.is_admin() then raise exception 'Administrator access is required'; end if;
  perform pg_advisory_xact_lock(421987);
  if char_length(trim(p_label)) not between 3 and 100 or p_mode not in ('random','algorithmic') or p_draw_date<=now() or p_draw_date is null then raise exception 'Invalid draw configuration'; end if;
  if p_prize_pool is null or p_prize_pool<0 then raise exception 'Bonus must be non-negative'; end if;
  if exists(select 1 from public.draws where status='draft') then raise exception 'Complete the existing open draw first'; end if;
  if exists(select 1 from public.draws where date_trunc('month',draw_date at time zone 'UTC')=date_trunc('month',p_draw_date at time zone 'UTC')) then raise exception 'Only one draw per calendar month is allowed'; end if;
  select count(distinct user_id) into members from public.subscriptions where status='active' and current_period_end>now();
  select rollover_jackpot into carried from public.draws where status in ('published','closed') order by draw_date desc limit 1;
  insert into public.draws(label,mode,draw_date,prize_pool,rollover_jackpot,jackpot_in)
  values(trim(p_label),p_mode,p_draw_date,members*100+round(p_prize_pool,2),coalesce(carried,0),coalesce(carried,0)) returning * into result;
  return result;
end; $$;

create or replace function public.publish_draw(p_draw_id uuid,p_winning_numbers smallint[])
returns jsonb language plpgsql security definer set search_path=public as $$
declare d public.draws; e record; m integer; c5 integer:=0; c4 integer:=0; c3 integer:=0; p5 numeric:=0; p4 numeric:=0; p3 numeric:=0; jackpot numeric:=0; reserve numeric:=0;
begin
  if not public.is_admin() then raise exception 'Administrator access is required'; end if;
  if not public.valid_draw_numbers(p_winning_numbers) then raise exception 'Five unique numbers from 1 to 45 are required'; end if;
  select * into d from public.draws where id=p_draw_id for update;
  if not found or d.status<>'draft' then raise exception 'Only a draft draw can be published'; end if;
  if d.draw_date>now() then raise exception 'Wait until the entry deadline before publishing'; end if;
  for e in select numbers from public.draw_entries where draw_id=p_draw_id loop
    select count(*) into m from unnest(e.numbers) n where n=any(p_winning_numbers);
    if m=5 then c5:=c5+1; elsif m=4 then c4:=c4+1; elsif m=3 then c3:=c3+1; end if;
  end loop;
  -- Equal integer-paise awards never overdraw a tier. Remainders are recorded.
  if c5>0 then p5:=trunc((trunc(d.prize_pool*.4,2)+d.rollover_jackpot)/c5,2); else jackpot:=trunc(d.prize_pool*.4,2)+d.rollover_jackpot; end if;
  if c4>0 then p4:=trunc(trunc(d.prize_pool*.35,2)/c4,2); end if;
  if c3>0 then p3:=trunc((d.prize_pool-trunc(d.prize_pool*.4,2)-trunc(d.prize_pool*.35,2))/c3,2); end if;
  reserve:=d.prize_pool+d.rollover_jackpot-jackpot-c5*p5-c4*p4-c3*p3;
  for e in select user_id,numbers from public.draw_entries where draw_id=p_draw_id loop
    select count(*) into m from unnest(e.numbers) n where n=any(p_winning_numbers);
    if m>=3 then insert into public.winners(draw_id,user_id,match_count,prize_amount) values(p_draw_id,e.user_id,m,case m when 5 then p5 when 4 then p4 else p3 end); end if;
  end loop;
  update public.draws set status='published',winning_numbers=p_winning_numbers,jackpot_in=d.rollover_jackpot,rollover_jackpot=jackpot,rounding_reserve=reserve where id=p_draw_id;
  return jsonb_build_object('winner_count',c5+c4+c3,'five_match_winners',c5,'four_match_winners',c4,'three_match_winners',c3,'next_jackpot',jackpot,'unawarded_reserve',reserve);
end; $$;

-- Only winners may upload, including replacement evidence after a rejection.
drop policy if exists "winner proof upload own folder" on storage.objects;
create policy "winner proof upload own folder" on storage.objects for insert to authenticated with check(
  bucket_id='winner-proofs' and (storage.foldername(name))[1]=auth.uid()::text
  and exists(select 1 from public.winners where user_id=auth.uid() and payout_status in ('pending_proof','rejected'))
);
create or replace function public.submit_winner_proof(p_winner_id uuid,p_proof_url text)
returns public.winners language plpgsql security definer set search_path=public as $$
declare w public.winners;
begin
  select * into w from public.winners where id=p_winner_id and user_id=auth.uid() for update;
  if not found or w.payout_status not in ('pending_proof','rejected') then raise exception 'Proof cannot be submitted for this record'; end if;
  if split_part(p_proof_url,'/',1)<>auth.uid()::text or not exists(select 1 from storage.objects where bucket_id='winner-proofs' and name=p_proof_url) then raise exception 'Upload proof to your private folder first'; end if;
  update public.winners set proof_url=p_proof_url,payout_status='under_review',reviewed_by=null,reviewed_at=null where id=p_winner_id returning * into w;
  return w;
end; $$;

-- Existing members without a choice can complete onboarding before checkout.
create or replace function public.choose_initial_charity(p_charity_id uuid,p_percent numeric)
returns void language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if p_percent is null or p_percent<10 or p_percent>100 then raise exception 'Contribution must be 10–100 percent'; end if;
  if exists(select 1 from public.member_charities where user_id=auth.uid()) and not public.is_active_member() then raise exception 'An active membership is required to change your saved choice'; end if;
  insert into public.member_charities(user_id,charity_id,contribution_percent) values(auth.uid(),p_charity_id,p_percent)
  on conflict(user_id) do update set charity_id=excluded.charity_id,contribution_percent=excluded.contribution_percent,updated_at=now();
end; $$;

-- Public aggregates expose no names, emails, member IDs, or private ledger rows.
create or replace function public.public_impact_summary() returns jsonb language sql stable security definer set search_path=public as $$
  select jsonb_build_object(
    'donated',coalesce((select sum(amount) from public.donations),0),
    'charities',(select count(*) from public.charities),
    'draw',(select jsonb_build_object('label',label,'status',status,'prize_pool',prize_pool,'jackpot',case when status='draft' then rollover_jackpot else jackpot_in end,'draw_date',draw_date,'numbers',winning_numbers) from public.draws where status in ('draft','published') order by (status='draft') desc,draw_date desc limit 1)
  )
$$;
revoke all on function public.choose_initial_charity(uuid,numeric) from public;
grant execute on function public.choose_initial_charity(uuid,numeric) to authenticated;
revoke all on function public.public_impact_summary() from public;
grant execute on function public.public_impact_summary() to anon,authenticated;
revoke all on function public.create_draw(text,text,timestamptz,numeric),public.publish_draw(uuid,smallint[]),public.submit_winner_proof(uuid,text) from public;
grant execute on function public.create_draw(text,text,timestamptz,numeric),public.publish_draw(uuid,smallint[]),public.submit_winner_proof(uuid,text) to authenticated;
commit;
