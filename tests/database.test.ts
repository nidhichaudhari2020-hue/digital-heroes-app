import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("PostgreSQL workflows and role boundaries (isolated database)",async(t)=>{
  const db=new PGlite();
  const admin="00000000-0000-4000-8000-000000000001", member="00000000-0000-4000-8000-000000000002", inactive="00000000-0000-4000-8000-000000000003";
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth; create schema storage;
      create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
      alter table storage.objects enable row level security;
      create function storage.foldername(text) returns text[] language sql immutable as $$ select string_to_array($1,'/') $$;`);
    await t.test("fresh schema plus all upgrades compile",async()=>{
      for(const file of ["schema.sql","production-upgrade.sql","release-hardening.sql"]) await db.exec(await readFile(`supabase/${file}`,"utf8"));
    });
    await t.test("upgrade migrations are safely rerunnable",async()=>{
      for(const file of ["production-upgrade.sql","release-hardening.sql"]) await db.exec(await readFile(`supabase/${file}`,"utf8"));
    });
    await db.exec(`grant usage on schema public,auth,storage to anon,authenticated;
      grant select,insert,update,delete on all tables in schema public to anon,authenticated;
      grant select,insert on storage.objects to authenticated;
      insert into auth.users(id,email) values('${admin}','admin@example.test'),('${member}','member@example.test'),('${inactive}','inactive@example.test');
      update public.profiles set role='admin' where id='${admin}';
      insert into public.subscriptions(user_id,plan,status,current_period_end) values('${member}','monthly','active',now()+interval '30 days');`);
    async function asUser<T=any>(id:string,sql:string,params:any[]=[]){await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec("set role authenticated");try{return await db.query<T>(sql,params)}finally{await db.exec("reset role")}}
    const charity=(await db.query<{id:string}>("select id from charities limit 1")).rows[0].id;
    const draw=(await db.query<{id:string}>("select id from draws limit 1")).rows[0].id;
    await t.test("signup creates member profile without privilege escalation",async()=>{const rows=(await asUser(member,"select * from profiles")).rows;assert.equal(rows.length,1);assert.equal(rows[0].role,"member");await asUser(member,"update profiles set role='admin' where id=$1",[member]);assert.equal((await db.query<{role:string}>("select role from profiles where id=$1",[member])).rows[0].role,"member");});
    await t.test("anonymous public browsing cannot read member profiles",async()=>{await db.query("select set_config('request.jwt.claim.sub','',false)");await db.exec("set role anon");try{assert.equal((await db.query("select * from profiles")).rows.length,0);assert.ok((await db.query("select * from charities")).rows.length>0);}finally{await db.exec("reset role")}});
    await t.test("inactive members cannot add scores",async()=>{await assert.rejects(asUser(inactive,"insert into scores(user_id,score_date,stableford_points) values($1,'2025-01-01',30)",[inactive]));});
    await t.test("active members retain only five newest scores",async()=>{for(let i=1;i<=6;i++)await asUser(member,"insert into scores(user_id,score_date,stableford_points) values($1,$2,30)",[member,`2025-01-0${i}`]);const rows=(await asUser(member,"select score_date::text from scores order by score_date desc")).rows;assert.equal(rows.length,5);assert.equal(rows[0].score_date,"2025-01-06");});
    await t.test("duplicate, future and out-of-range scores rejected by database",async()=>{
      await assert.rejects(asUser(member,"insert into scores(user_id,score_date,stableford_points) values($1,'2025-01-06',30)",[member]));
      await assert.rejects(asUser(member,"insert into scores(user_id,score_date,stableford_points) values($1,'2099-01-01',30)",[member]));
      await assert.rejects(asUser(member,"insert into scores(user_id,score_date,stableford_points) values($1,'2025-02-01',46)",[member]));
    });
    await t.test("member can edit a score and admin can read it",async()=>{await asUser(member,"update scores set stableford_points=38 where score_date='2025-01-06'");assert.equal((await asUser(admin,"select * from scores")).rows.length,5);});
    await t.test("public visitors cannot read, insert, edit or delete scores",async()=>{
      await db.query("select set_config('request.jwt.claim.sub','',false)");
      await db.exec("set role anon");
      try {
        assert.equal((await db.query("select * from scores")).rows.length,0);
        await assert.rejects(db.query("insert into scores(user_id,score_date,stableford_points) values($1,'2025-02-01',30)",[member]));
        assert.equal((await db.query("update scores set stableford_points=1 returning id")).rows.length,0);
        assert.equal((await db.query("delete from scores returning id")).rows.length,0);
      } finally { await db.exec("reset role"); }
      assert.equal((await db.query("select * from scores")).rows.length,5);
    });
    await t.test("charity minimum, initial selection and ownership enforced",async()=>{
      await assert.rejects(asUser(member,"select choose_initial_charity($1,9)",[charity]));
      await asUser(member,"select choose_initial_charity($1,10)",[charity]);
      await asUser(inactive,"select choose_initial_charity($1,10)",[charity]);
      await assert.rejects(asUser(inactive,"select choose_initial_charity($1,20)",[charity]));
      assert.equal((await asUser(member,"select * from member_charities")).rows.length,1);
    });
    await db.query("update draws set draw_date=now()+interval '1 day',prize_pool=1000 where id=$1",[draw]);
    await t.test("draw eligibility and unique-five validation",async()=>{
      await assert.rejects(asUser(inactive,"insert into draw_entries(draw_id,user_id,numbers) values($1,$2,array[1,2,3,4,5])",[draw,inactive]));
      await assert.rejects(asUser(member,"insert into draw_entries(draw_id,user_id,numbers) values($1,$2,array[1,1,3,4,5])",[draw,member]));
      await asUser(member,"insert into draw_entries(draw_id,user_id,numbers) values($1,$2,array[1,2,3,4,5])",[draw,member]);
    });
    await t.test("only admin can publish and cannot publish before deadline",async()=>{
      await assert.rejects(asUser(member,"select publish_draw($1,array[1,2,3,4,5]::smallint[])",[draw]));
      await assert.rejects(asUser(admin,"select publish_draw($1,array[1,2,3,4,5]::smallint[])",[draw]));
    });
    await db.query("update draws set draw_date=now()-interval '1 minute' where id=$1",[draw]);
    await t.test("publication calculates 40% jackpot and is single-use",async()=>{
      await asUser(admin,"select publish_draw($1,array[1,2,3,4,5]::smallint[])",[draw]);
      assert.equal(Number((await asUser(member,"select prize_amount from winners")).rows[0].prize_amount),400);
      await assert.rejects(asUser(admin,"select publish_draw($1,array[1,2,3,4,5]::smallint[])",[draw]));
      await assert.rejects(asUser(member,"update draw_entries set numbers=array[6,7,8,9,10] where draw_id=$1",[draw]).then(r=>{if(r.affectedRows===0)throw Error("RLS blocked");}));
    });
    const winner=(await db.query<{id:string}>("select id from winners where user_id=$1",[member])).rows[0].id;
    await t.test("proof and payout require winner ownership and approval",async()=>{
      await assert.rejects(asUser(admin,"select review_winner($1,'paid')",[winner]));
      await assert.rejects(asUser(member,"select submit_winner_proof($1,$2)",[winner,member+"/missing.png"]));
      await asUser(member,"insert into storage.objects(bucket_id,name) values('winner-proofs',$1)",[member+"/proof.png"]);
      await asUser(member,"select submit_winner_proof($1,$2)",[winner,member+"/proof.png"]);
      await assert.rejects(asUser(inactive,"select submit_winner_proof($1,$2)",[winner,member+"/proof.png"]));
      await asUser(admin,"select review_winner($1,'rejected')",[winner]);
      await asUser(member,"select submit_winner_proof($1,$2)",[winner,member+"/proof.png"]);
      await asUser(admin,"select review_winner($1,'approved')",[winner]);await asUser(admin,"select review_winner($1,'paid')",[winner]);
      assert.equal((await asUser(member,"select payout_status from winners")).rows[0].payout_status,"paid");
    });
    await t.test("admin charity and event CRUD works with public visibility",async()=>{
      const added=(await asUser(admin,"insert into charities(name,slug,description) values('Test cause','test-cause','Test') returning id")).rows[0].id;
      await asUser(admin,"insert into charity_events(charity_id,title) values($1,'Test event')",[added]);
      assert.equal((await asUser(member,"select * from charity_events where charity_id=$1",[added])).rows.length,1);
      await asUser(admin,"update charities set description='Updated' where id=$1",[added]);await asUser(admin,"delete from charities where id=$1",[added]);
      assert.equal((await db.query("select * from charity_events where charity_id=$1",[added])).rows.length,0);
    });
    await t.test("expiry immediately removes score write access",async()=>{await db.query("update subscriptions set current_period_end=now()-interval '1 day' where user_id=$1",[member]);await assert.rejects(asUser(member,"insert into scores(user_id,score_date,stableford_points) values($1,'2025-03-01',30)",[member]));});
  } finally { await db.close(); }
});
