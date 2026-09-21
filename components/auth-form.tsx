"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Charity = { id: string; name: string };

function authErrorMessage(message: string) {
  if (/failed to fetch|network|load failed/i.test(message)) {
    return "We cannot reach the configured Supabase project. Copy the Project URL again from Supabase Settings → API Keys, update .env.local, then restart the app.";
  }
  return message;
}

export function AuthForm() {
  const [mode, setMode] = useState<"login" | "signup">("signup");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [charities, setCharities] = useState<Charity[]>([]);
  const [charityId, setCharityId] = useState("");
  const [contributionPercent, setContributionPercent] = useState(10);
  const router = useRouter();

  useEffect(() => {
    let mounted = true;
    async function loadCharities() {
      try {
        const { data, error } = await createClient()
          .from("charities")
          .select("id,name")
          .order("is_featured", { ascending: false });
        if (!error && data && mounted) {
          setCharities(data);
          if (data[0]) setCharityId((current) => current || data[0].id);
        }
      } catch {
        // Submit shows a useful connection error without distracting visitors on load.
      }
    }
    loadCharities();
    return () => { mounted = false; };
  }, []);

  async function submit(formData: FormData) {
    setBusy(true);
    setMessage("");
    const email = String(formData.get("email"));
    const password = String(formData.get("password"));

    try {
      const supabase = createClient();
      if (mode === "signup") {
        const fullName = String(formData.get("fullName"));
        if (!charityId && charities.length) {
          setMessage("Please choose the cause you want your membership to support.");
          return;
        }
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              full_name: fullName,
              charity_id: charityId || undefined,
              contribution_percent: contributionPercent,
            },
            emailRedirectTo: `${location.origin}/auth/callback?next=/dashboard`,
          },
        });
        if (error) setMessage(authErrorMessage(error.message));
        else setMessage("Account created. Check your inbox to confirm your email, then log in.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) setMessage(authErrorMessage(error.message));
        else {
          router.push("/dashboard");
          router.refresh();
        }
      }
    } catch {
      setMessage("We could not reach the membership service. Copy the Project URL again from Supabase Settings → API Keys, then restart the app.");
    } finally {
      setBusy(false);
    }
  }

  return <section className="auth-card">
    <div className="tabs">
      <button type="button" className={mode === "signup" ? "active" : ""} onClick={() => setMode("signup")}>Create account</button>
      <button type="button" className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>Log in</button>
    </div>
    <form action={submit}>
      {mode === "signup" && <label>Full name<input name="fullName" required placeholder="Alex Morgan" /></label>}
      <label>Email<input name="email" type="email" required placeholder="you@example.com" /></label>
      <label>Password<input name="password" type="password" minLength={8} required placeholder="At least 8 characters" /></label>
      {mode === "signup" && <fieldset className="signup-impact">
        <legend>Your impact</legend>
        <p>Your first membership contribution is saved now. You can change it later in your dashboard.</p>
        <label>Choose a charity
          <select value={charityId} onChange={(event) => setCharityId(event.target.value)} disabled={!charities.length}>
            {!charities.length && <option value="">Loading available causes…</option>}
            {charities.map((charity) => <option key={charity.id} value={charity.id}>{charity.name}</option>)}
          </select>
        </label>
        <label>Contribution percentage
          <input value={contributionPercent} onChange={(event) => setContributionPercent(Number(event.target.value))} type="number" min="10" max="100" required />
        </label>
      </fieldset>}
      <button className="button" disabled={busy}>{busy ? "Please wait…" : mode === "signup" ? "Create account" : "Log in"}</button>
    </form>
    {message && <p className={message.includes("could not") || message.includes("cannot") || message.includes("Please") ? "message message--error" : "message"}>{message}</p>}
  </section>;
}
