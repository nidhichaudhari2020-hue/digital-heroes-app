import { test } from "node:test";
import assert from "node:assert/strict";
import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { processBillingEvent } from "../lib/billing-webhook";

function fixture(failTable="", missingChoice=false) {
  const writes: {table:string;value:any;options:any}[]=[];
  const ledger=new Map<string,unknown>();
  const stripe={subscriptions:{retrieve:async()=>({id:"sub_1",customer:"cus_1",status:"active",metadata:{user_id:"member",plan:"monthly"},items:{data:[{}]},current_period_end:2000000000,cancel_at_period_end:false})}} as unknown as Stripe;
  const db={from(table:string){let value:any;let options:any;const result=()=>{
    if(table===failTable)return{data:null,error:{message:"simulated database failure"}};
    if(value){writes.push({table,value,options});if(table==="donations"&&!ledger.has(value.stripe_payment_id))ledger.set(value.stripe_payment_id,value);}
    return{data:table==="subscriptions"?{id:"row_1",user_id:"member"}:table==="member_charities"?(missingChoice?null:{charity_id:"cause",contribution_percent:10}):null,error:null};
  };const builder:any={upsert(v:any,o:any){value=v;options=o;return builder},select(){return builder},eq(){return builder},single:async()=>result(),maybeSingle:async()=>result(),then(resolve:any,reject:any){return Promise.resolve(result()).then(resolve,reject)}};return builder}} as unknown as SupabaseClient;
  return {db,stripe,writes,ledger};
}
const invoice={type:"invoice.paid",livemode:false,data:{object:{id:"in_1",subscription:"sub_1",paid:true,currency:"inr",amount_paid:29900}}} as unknown as Stripe.Event;
test("invoice arriving first creates subscription then donation",async()=>{const f=fixture();await processBillingEvent(invoice,f.stripe,f.db);assert.deepEqual(f.writes.map(w=>w.table),["subscriptions","donations"]);assert.equal(f.writes[1].value.amount,29.9);});
test("duplicate delivery preserves one donation row",async()=>{const f=fixture();await processBillingEvent(invoice,f.stripe,f.db);await processBillingEvent(invoice,f.stripe,f.db);assert.equal(f.ledger.size,1);assert.equal(f.writes.at(-1)?.options.ignoreDuplicates,true);});
for(const table of ["subscriptions","donations","member_charities"])test(`database ${table} errors reject for retry`,async()=>{const f=fixture(table);await assert.rejects(processBillingEvent(invoice,f.stripe,f.db));});
test("missing charity rejects instead of silently losing contribution",async()=>{const f=fixture("",true);await assert.rejects(processBillingEvent(invoice,f.stripe,f.db));});
test("live-mode events are blocked in evaluation environment",async()=>{const f=fixture();await assert.rejects(processBillingEvent({...invoice,livemode:true},f.stripe,f.db));});
test("unpaid independent donations are ignored",async()=>{const f=fixture();await processBillingEvent({type:"checkout.session.completed",livemode:false,data:{object:{payment_status:"unpaid",metadata:{type:"independent_donation"}}}} as unknown as Stripe.Event,f.stripe,f.db);assert.equal(f.writes.length,0);});
test("foreign-currency membership invoices are rejected",async()=>{const f=fixture();const event=structuredClone(invoice);(event.data.object as any).currency="usd";await assert.rejects(processBillingEvent(event,f.stripe,f.db));});
