"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function AuthForm() {
  const [mode,setMode]=useState<"login"|"signup">("signup"); const [message,setMessage]=useState(""); const [busy,setBusy]=useState(false); const router=useRouter();
  async function submit(formData:FormData) {
    setBusy(true);setMessage("");const supabase=createClient();const email=String(formData.get("email"));const password=String(formData.get("password"));
    if(mode==="signup") { const fullName=String(formData.get("fullName")); const {error}=await supabase.auth.signUp({email,password,options:{data:{full_name:fullName},emailRedirectTo:`${location.origin}/dashboard`}}); if(error)setMessage(error.message);else setMessage("Account created. Check your email to confirm it, then log in."); }
    else {const {error}=await supabase.auth.signInWithPassword({email,password});if(error)setMessage(error.message);else {router.push("/dashboard");router.refresh();}}
    setBusy(false);
  }
  return <section className="auth-card"><div className="tabs"><button className={mode==="signup"?"active":""} onClick={()=>setMode("signup")}>Create account</button><button className={mode==="login"?"active":""} onClick={()=>setMode("login")}>Log in</button></div><form action={submit}>{mode==="signup"&&<label>Full name<input name="fullName" required placeholder="Alex Morgan" /></label>}<label>Email<input name="email" type="email" required placeholder="you@example.com" /></label><label>Password<input name="password" type="password" minLength={8} required placeholder="At least 8 characters" /></label><button className="button" disabled={busy}>{busy?"Please wait…":mode==="signup"?"Create account":"Log in"}</button></form>{message&&<p className="message">{message}</p>}</section>;
}
