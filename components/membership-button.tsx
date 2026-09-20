"use client";
import { useState } from "react";
export function MembershipButton({plan}:{plan:"monthly"|"yearly"}){const [busy,setBusy]=useState(false);async function checkout(){setBusy(true);const response=await fetch("/api/checkout",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({plan})});const data=await response.json();if(data.url)location.href=data.url;else alert(data.error||"Unable to start checkout");setBusy(false)}return <button className="button" onClick={checkout} disabled={busy}>{busy?"Opening checkout…":`Choose ${plan}`}</button>}
