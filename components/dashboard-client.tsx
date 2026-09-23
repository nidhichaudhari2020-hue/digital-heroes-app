"use client";

import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { addScore } from "@/lib/scores";
import { MembershipPlans } from "@/components/membership-button";
import { formatINR } from "@/lib/pricing";
import { BillingButton } from "@/components/billing-button";
import { isActiveSubscription } from "@/lib/billing";

type Score = { id: string; date: string; points: number };
type Charity = { id: string; name: string; description: string };
type Subscription = { plan: string; status: string; current_period_end: string | null; cancel_at_period_end?: boolean };
type Draw = { id: string; label: string; draw_date: string; prize_pool: number; status: string };
type Entry = { id: string; draw_id: string; numbers: number[] };
type Winner = { id: string; match_count: number; prize_amount: number; payout_status: string; proof_url: string | null };
type Donation = { id: string; amount: number; charity_id: string; created_at: string };

function dateLabel(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

function dateTimeLabel(value: string) {
  return new Date(value).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export function DashboardClient({ userId, name }: { userId: string; name: string }) {
  const supabase = createClient();
  const [scores, setScores] = useState<Score[]>([]);
  const [charities, setCharities] = useState<Charity[]>([]);
  const [choice, setChoice] = useState("");
  const [percentage, setPercentage] = useState(10);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [draw, setDraw] = useState<Draw | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [entryDraws, setEntryDraws] = useState<Draw[]>([]);
  const [entry, setEntry] = useState<number[]>([]);
  const [winners, setWinners] = useState<Winner[]>([]);
  const [donations, setDonations] = useState<Donation[]>([]);
  const [profileName, setProfileName] = useState(name);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Score | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);

  const active = isActiveSubscription(subscription);
  const eligible = active && scores.length === 5;
  const selectedCharity = charities.find((item) => item.id === choice)?.name || "Choose a cause";
  const totalWon = useMemo(() => winners.reduce((sum, item) => sum + Number(item.prize_amount), 0), [winners]);
  const totalDonated = useMemo(() => donations.reduce((sum, item) => sum + Number(item.amount), 0), [donations]);
  const drawName = (drawId: string) => entryDraws.find((item) => item.id === drawId)?.label || "Published draw";
  const charityName = (charityId: string) => charities.find((item) => item.id === charityId)?.name || "Your chosen cause";

  function tell(value: string) {
    setNotice(value);
    window.setTimeout(() => setNotice(""), 12000);
  }

  async function load() {
    setLoading(true);
    try {
      const [scoreResult, charityResult, choiceResult, subscriptionResult, drawResult, winnerResult, entryResult, donationResult] = await Promise.all([
        supabase.from("scores").select("id,score_date,stableford_points").eq("user_id", userId).order("score_date", { ascending: false }),
        supabase.from("charities").select("id,name,description").order("is_featured", { ascending: false }),
        supabase.from("member_charities").select("charity_id,contribution_percent").eq("user_id", userId).maybeSingle(),
        supabase.from("subscriptions").select("plan,status,current_period_end,created_at,cancel_at_period_end").eq("user_id", userId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
        supabase.from("draws").select("id,label,draw_date,prize_pool,status").eq("status", "draft").gt("draw_date", new Date().toISOString()).order("draw_date", { ascending: true }).limit(1).maybeSingle(),
        supabase.from("winners").select("id,match_count,prize_amount,payout_status,proof_url").eq("user_id", userId).order("created_at", { ascending: false }),
        supabase.from("draw_entries").select("id,draw_id,numbers").eq("user_id", userId),
        supabase.from("donations").select("id,amount,charity_id,created_at").eq("user_id", userId).order("created_at", { ascending: false }),
      ]);

      const firstError = [scoreResult, charityResult, choiceResult, subscriptionResult, drawResult, winnerResult, entryResult, donationResult].find((result) => result.error)?.error;
      if (firstError) tell(`Some dashboard data could not load: ${firstError.message}`);
      setScores((scoreResult.data || []).map((item) => ({ id: item.id, date: item.score_date, points: item.stableford_points })));
      setCharities(charityResult.data || []);
      setChoice(choiceResult.data?.charity_id || "");
      setPercentage(Number(choiceResult.data?.contribution_percent || 10));
      setSubscription(subscriptionResult.data || null);
      setDraw(drawResult.data || null);
      setWinners(winnerResult.data || []);
      setEntries(entryResult.data || []);
      setDonations(donationResult.data || []);

      if (drawResult.data) {
        const currentEntry = (entryResult.data || []).find((item) => item.draw_id === drawResult.data?.id);
        setEntry(currentEntry?.numbers || []);
      } else setEntry([]);

      const drawIds = [...new Set((entryResult.data || []).map((item) => item.draw_id))];
      if (drawIds.length) {
        const { data: relatedDraws } = await supabase.from("draws").select("id,label,draw_date,prize_pool,status").in("id", drawIds);
        setEntryDraws(relatedDraws || []);
      } else setEntryDraws([]);
    } catch {
      tell("We could not reach your member data. Check your Supabase environment variables and try again.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function saveScore(formData: FormData) {
    if (!active) {
      tell("An active membership is required to manage scores.");
      return;
    }
    const candidate = { date: String(formData.get("date")), points: Number(formData.get("points")) };
    if (candidate.date > new Date().toLocaleDateString("en-CA") || !Number.isInteger(candidate.points) || candidate.points < 1 || candidate.points > 45) { tell("Enter a past or current date and a whole score from 1 to 45."); return; }
    if (!editing) {
      const checked = addScore(scores.map((item) => ({ date: item.date, points: item.points })), candidate);
      if ("error" in checked) {
        tell(checked.error);
        return;
      }
    }
    const payload = { score_date: candidate.date, stableford_points: candidate.points };
    const result = editing
      ? await supabase.from("scores").update(payload).eq("id", editing.id)
      : await supabase.from("scores").insert({ user_id: userId, ...payload });
    if (result.error) tell(result.error.message);
    else {
      setEditing(null);
      tell(editing ? "Score updated." : "Score saved. Your five latest entries are retained.");
      await load();
    }
  }

  async function removeScore(id: string) {
    if (!active) { tell("An active membership is required to manage scores."); return; }
    if (!window.confirm("Delete this score?")) return;
    const { error } = await supabase.from("scores").delete().eq("id", id);
    if (error) tell(error.message);
    else {
      tell("Score removed.");
      await load();
    }
  }

  async function saveCause() {
    if (!choice || !Number.isFinite(percentage) || percentage < 10 || percentage > 100) {
      tell("Choose a cause and set a contribution between 10% and 100%.");
      return;
    }
    const { error } = await supabase.rpc("choose_initial_charity", { p_charity_id: choice, p_percent: percentage });
    if (error) tell(error.message);
    else tell("Your impact preference is saved.");
  }

  async function saveProfile() {
    if (profileName.trim().length < 2) {
      tell("Enter a name with at least two characters.");
      return;
    }
    setSavingProfile(true);
    const { error } = await supabase.rpc("update_profile_name", { p_full_name: profileName });
    setSavingProfile(false);
    if (error) tell(error.message);
    else tell("Your profile settings are saved.");
  }

  function toggleNumber(value: number) {
    setEntry((current) => current.includes(value)
      ? current.filter((item) => item !== value)
      : current.length === 5 ? current : [...current, value].sort((a, b) => a - b));
  }

  async function saveEntry() {
    if (!draw) {
      tell("There is no upcoming draw yet. Check back after an administrator opens one.");
      return;
    }
    if (!eligible) {
      tell(active ? "Save all five recent scores to unlock draw entry." : "Activate a membership to enter the draw.");
      return;
    }
    if (entry.length !== 5) {
      tell("Select exactly five draw numbers.");
      return;
    }
    const { error } = await supabase.from("draw_entries").upsert({ draw_id: draw.id, user_id: userId, numbers: entry }, { onConflict: "draw_id,user_id" });
    if (error) tell(error.message);
    else {
      tell("Your draw entry is saved.");
      await load();
    }
  }

  async function uploadProof(event: ChangeEvent<HTMLInputElement>, winner: Winner) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024 || !["image/jpeg","image/png","image/webp","application/pdf"].includes(file.type)) { tell("Upload a PNG, JPEG, WebP or PDF no larger than 5 MB."); return; }
    const path = `${userId}/${winner.id}-${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "-")}`;
    const upload = await supabase.storage.from("winner-proofs").upload(path, file, { upsert: false });
    if (upload.error) {
      tell(upload.error.message);
      return;
    }
    const { error } = await supabase.rpc("submit_winner_proof", { p_winner_id: winner.id, p_proof_url: path });
    if (error) tell(error.message);
    else {
      tell("Proof uploaded for review.");
      await load();
    }
  }

  if (loading) return <div className="loading-state">Loading your member space…</div>;

  return <>
    <div className="dashboard-grid">
      <article className="panel"><small>MEMBERSHIP</small><h3>{active ? `${subscription?.plan || "Membership"} plan` : "Not active"}</h3><p>{active && subscription?.current_period_end ? `${subscription.cancel_at_period_end ? "Access ends" : "Renews"} ${dateTimeLabel(subscription.current_period_end)}` : "Choose a plan to unlock member features."}</p><b>{active ? "ACTIVE MEMBERSHIP" : subscription?.status?.toUpperCase() || "ACTION REQUIRED"}</b>{subscription && <BillingButton/>}</article>
      <article className="panel"><small>YOUR CAUSE</small><h3>{selectedCharity}</h3><p>{choice ? `${percentage}% of your membership supports this cause.` : "Pick a cause that matters to you."}</p><b>MINIMUM 10%</b></article>
      <article className="panel"><small>PARTICIPATION</small><h3>{entries.length} draw{entries.length === 1 ? "" : "s"}</h3><p>{draw ? `${draw.label} is open for entry.` : "The next draw will appear here."}</p><b>{draw ? "UPCOMING DRAW" : "NO LIVE DRAW"}</b></article>
      <article className="panel"><small>WINNINGS</small><h3>{formatINR(totalWon)}</h3><p>{winners.length ? `${winners.length} result${winners.length > 1 ? "s" : ""} recorded.` : "No winning entries yet."}</p><b>{winners.some((item) => item.payout_status !== "paid") ? "ACTION MAY BE REQUIRED" : "NO PAYMENTS PENDING"}</b></article>
    </div>

    {!active && <section className="notice"><b>Activate your membership.</b> Choose a monthly or yearly INR plan to save scores, update your cause, and enter the next draw.</section>}
    {!active && <MembershipPlans compact />}

    {active ? <section className="dashboard-section scores-panel">
      <div className="dashboard-section__head"><div><p className="eyebrow eyebrow--light">YOUR LATEST FIVE</p><h2>Form tracker</h2></div><p>Stableford scores must be from 1 to 45. Duplicate dates are edited or deleted — never added twice.</p></div>
      <div className="score-list">{scores.map((item) => <div key={item.id}><div className="score">{item.points}<span>{dateLabel(item.date)}</span></div><div className="score-actions"><button className="icon-button" onClick={() => setEditing(item)}>EDIT</button><button className="icon-button" onClick={() => removeScore(item.id)}>DELETE</button></div></div>)}{!scores.length && <p className="empty-copy">No rounds saved yet. Add your first recent Stableford score below.</p>}</div>
      <form className="score-form" action={saveScore}><label>Date<input name="date" type="date" defaultValue={editing?.date || ""} key={`date-${editing?.id || "new"}`} required /></label><label>Stableford score<input name="points" type="number" min="1" max="45" defaultValue={editing?.points || ""} key={`points-${editing?.id || "new"}`} required placeholder="1 - 45" /></label><button className="button" disabled={!active}>{editing ? "Update score" : "Save score"}</button>{editing && <button type="button" className="button button--secondary" onClick={() => setEditing(null)}>Cancel</button>}</form>
    </section> : <section className="dashboard-section"><h2>Member score tracker</h2><p>An active paid membership is required to add, edit, or delete golf scores.</p></section>}

    <div className="summary-grid">
      <section id="charity-choice" className="dashboard-section"><div className="dashboard-section__head"><div><p className="eyebrow">CHARITY CONTRIBUTION</p><h2>Direct your impact</h2></div></div><div className="choice-grid"><label>Choose a charity<select value={choice} onChange={(event) => setChoice(event.target.value)} ><option value="">Select a cause</option>{charities.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Contribution %<input value={percentage} onChange={(event) => setPercentage(Number(event.target.value))} type="number" min="10" max="100" step="0.01" /></label><button className="button" type="button" onClick={saveCause}>Save choice</button></div></section>
      <section className="dashboard-section"><div className="dashboard-section__head"><div><p className="eyebrow">MONTHLY DRAW</p><h2>Your entry</h2></div><p>{draw ? `Select five unique numbers for ${draw.label}.` : "A draw will appear when the administrator opens it."}</p></div><div className="entry-numbers">{Array.from({ length: 45 }, (_, index) => index + 1).map((number) => <button type="button" className={`entry-number ${entry.includes(number) ? "entry-number--selected" : ""}`} onClick={() => toggleNumber(number)} key={number} disabled={!eligible}>{number}</button>)}</div><div className="entry-form"><span className="entry-count">{entry.length}/5 numbers selected</span><span /><button className="button" type="button" onClick={saveEntry} disabled={!eligible}>Save draw entry</button></div></section>
    </div>

    <div className="summary-grid">
      <section className="dashboard-section"><div className="dashboard-section__head"><div><p className="eyebrow">PARTICIPATION HISTORY</p><h2>Your draw record</h2></div><p>Every submitted entry is retained against its draw.</p></div>{entries.length ? <div className="mini-list">{entries.map((item) => <div key={item.id}><b>{drawName(item.draw_id)}</b><span>{item.numbers.map((number) => String(number).padStart(2, "0")).join(" · ")}</span></div>)}</div> : <p className="empty-copy">No draw entries yet. Complete your latest five scores and choose five numbers when a draw opens.</p>}</section>
      <section className="dashboard-section"><div className="dashboard-section__head"><div><p className="eyebrow">PROFILE & SETTINGS</p><h2>Keep it current</h2></div><p>Your role and payments are protected; you can update your display name here.</p></div><form className="profile-form" action={saveProfile}><label>Full name<input value={profileName} onChange={(event) => setProfileName(event.target.value)} minLength={2} maxLength={100} required /></label><button className="button" disabled={savingProfile}>{savingProfile ? "Saving…" : "Save profile"}</button></form></section>
    </div>

    <section className="dashboard-section"><div className="dashboard-section__head"><div><p className="eyebrow">IMPACT LEDGER</p><h2>Your giving history</h2></div><p>{totalDonated ? `${formatINR(totalDonated)} recorded from successful subscription and direct donations.` : "Successful contributions will appear here."}</p></div>{donations.length ? <table className="data-table"><thead><tr><th>Date</th><th>Cause</th><th>Contribution</th></tr></thead><tbody>{donations.map((item) => <tr key={item.id}><td>{dateTimeLabel(item.created_at)}</td><td>{charityName(item.charity_id)}</td><td>{formatINR(Number(item.amount), 2)}</td></tr>)}</tbody></table> : <p className="empty-copy">No contributions have settled yet. Once Stripe confirms a payment, this ledger updates automatically.</p>}</section>

    <section className="dashboard-section"><div className="dashboard-section__head"><div><p className="eyebrow">WINNINGS & VERIFICATION</p><h2>Stay on top of results</h2></div><p>Only winners upload score evidence. An administrator reviews the proof before a payout is marked paid.</p></div>{winners.length ? <table className="data-table"><thead><tr><th>Match</th><th>Prize</th><th>Status</th><th>Proof</th></tr></thead><tbody>{winners.map((item) => <tr key={item.id}><td>{item.match_count} number match</td><td>{formatINR(Number(item.prize_amount), 2)}</td><td>{item.payout_status.replaceAll("_", " ")}</td><td>{["pending_proof","rejected"].includes(item.payout_status) ? <label className="upload-label">Upload screenshot<input type="file" accept="image/*,.pdf" onChange={(event) => uploadProof(event, item)} /></label> : item.proof_url ? "Submitted" : "Not needed"}</td></tr>)}</tbody></table> : <p className="empty-copy">No results to verify yet. When you win, the proof upload and payout progress will appear here.</p>}</section>
    {notice && <p className="toast-message" role="status">{notice}</p>}
  </>;
}
