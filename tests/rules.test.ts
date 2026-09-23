import { test } from "node:test";
import assert from "node:assert/strict";
import { addScore } from "../lib/scores";
import { simulateDraw, simulateWeightedDraw, countMatches, calculatePrizes } from "../lib/draw";
import { contributionAmount, subscriptionStatus, isActiveSubscription, appUrl, billingConfigured } from "../lib/billing";
import { MEMBERSHIP_PLANS } from "../lib/pricing";

test("checkout rejects placeholder credentials and returns to the current local port",()=>{
  const keys = ["STRIPE_SECRET_KEY", "NEXT_PUBLIC_APP_URL", "VERCEL", "VERCEL_PROJECT_PRODUCTION_URL"];
  const saved = keys.map(key=>process.env[key]);
  try {
    keys.forEach(key=>delete process.env[key]);
    process.env.STRIPE_SECRET_KEY="sk_test_...";
    assert.equal(billingConfigured(),false);
    assert.equal(appUrl("http://localhost:3002/api/checkout"),"http://localhost:3002");
    process.env.NEXT_PUBLIC_APP_URL="https://example.test";
    assert.equal(appUrl("http://localhost:3002"),"https://example.test");
  } finally { keys.forEach((key,index)=>{if(saved[index]===undefined)delete process.env[key];else process.env[key]=saved[index];}); }
});

test("scores retain the newest five in descending date order", () => {
  const scores = Array.from({length:5},(_,i)=>({date:`2025-01-0${i+1}`,points:30+i}));
  const result = addScore(scores,{date:"2025-01-06",points:45});
  assert.ok("scores" in result);
  assert.deepEqual(result.scores.map(s=>s.date),["2025-01-06","2025-01-05","2025-01-04","2025-01-03","2025-01-02"]);
});
for (const points of [0,46,NaN,2.5]) test(`rejects invalid score ${points}`,()=>assert.ok("error" in addScore([],{date:"2025-01-01",points})));
test("rejects duplicate, invalid and future dates",()=>{
  assert.ok("error" in addScore([{date:"2025-01-01",points:30}],{date:"2025-01-01",points:35}));
  assert.ok("error" in addScore([],{date:"invalid",points:30}));
  assert.ok("error" in addScore([],{date:"2099-01-01",points:30}));
});
test("both random and weighted draws produce five unique valid numbers",()=>{
  for(let i=0;i<100;i++) for(const numbers of [simulateDraw(),simulateWeightedDraw([1,1,1,45,30])]) {
    assert.equal(numbers.length,5);assert.equal(new Set(numbers).size,5);assert.ok(numbers.every(n=>n>=1&&n<=45));
  }
});
test("match counts and 40/35/25 tier allocations",()=>{
  assert.equal(countMatches([1,2,3,4,9],[1,2,3,4,5]),4);
  assert.deepEqual(calculatePrizes(1000,100,{five:2,four:1,three:5}),{five:250,four:350,three:50,nextJackpot:0});
  assert.deepEqual(calculatePrizes(1000,100,{five:0,four:0,three:0}),{five:0,four:0,three:0,nextJackpot:500});
});
test("INR prices and yearly saving are consistent",()=>{assert.equal(MEMBERSHIP_PLANS.monthly.amount*12-MEMBERSHIP_PLANS.yearly.amount,589);});
test("contributions use paid paise and two-decimal rounding",()=>{
  assert.equal(contributionAmount(29900,10),29.9);assert.equal(contributionAmount(299900,10),299.9);
  assert.equal(contributionAmount(29900,100),299);assert.throws(()=>contributionAmount(1000,9));
  assert.throws(()=>contributionAmount(1000,NaN));assert.throws(()=>contributionAmount(-1,10));
});
test("access requires active status AND an unexpired dated subscription",()=>{
  assert.equal(isActiveSubscription({status:"active",current_period_end:"2099-01-01"}),true);
  for(const status of ["cancelled","past_due","lapsed"]) assert.equal(isActiveSubscription({status,current_period_end:"2099-01-01"}),false);
  assert.equal(isActiveSubscription({status:"active",current_period_end:null}),false);
  assert.equal(isActiveSubscription({status:"active",current_period_end:"2020-01-01"}),false);
  assert.equal(subscriptionStatus("unpaid"),"past_due");assert.equal(subscriptionStatus("canceled"),"cancelled");
});
