"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { simulateDraw, simulateWeightedDraw } from "@/lib/draw";
import { formatINR } from "@/lib/pricing";

type Tab = "overview" | "members" | "draws" | "charities" | "winners" | "reports";
type Profile = { id: string; full_name: string; role: string; created_at: string };
type Charity = { id: string; name: string; slug: string; description: string; image_url: string | null; is_featured: boolean };
type Draw = { id: string; label: string; status: string; mode: string; draw_date: string; prize_pool: number; rollover_jackpot: number; winning_numbers: number[] | null };
type Winner = { id: string; user_id: string; draw_id: string; match_count: number; prize_amount: number; payout_status: string; proof_url: string | null };
type Subscription = { id: string; user_id: string; plan: string; status: string; current_period_end: string | null };
type Score = { id: string; user_id: string; score_date: string; stableford_points: number };
type Entry = { id: string; user_id: string; draw_id: string; numbers: number[] };
type Donation = { id: string; amount: number; charity_id: string; created_at: string };
type CharityEvent = { id: string; charity_id: string; title: string; event_date: string | null; location: string | null; description: string | null };
type Simulation = { drawId: string; numbers: number[] };

const tabs: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "members", label: "Users & subscriptions" },
  { id: "draws", label: "Draws" },
  { id: "charities", label: "Charities & content" },
  { id: "winners", label: "Winners & payouts" },
  { id: "reports", label: "Reports & analytics" },
];
const isCurrentSubscription = (item: Subscription) => item.status === "active" && (item.current_period_end && new Date(item.current_period_end).getTime() > Date.now());
const payoutTransitions: Record<string, string[]> = {
  pending_proof: ["pending_proof", "rejected"],
  under_review: ["under_review", "approved", "rejected"],
  approved: ["approved", "paid", "rejected"],
  rejected: ["rejected", "under_review"],
  paid: ["paid"],
};
const fixedPrizeContribution = 100;

export function AdminClient() {
  const supabase = createClient();
  const [tab, setTab] = useState<Tab>("overview");
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [charities, setCharities] = useState<Charity[]>([]);
  const [draws, setDraws] = useState<Draw[]>([]);
  const [winners, setWinners] = useState<Winner[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [scores, setScores] = useState<Score[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [donations, setDonations] = useState<Donation[]>([]);
  const [events, setEvents] = useState<CharityEvent[]>([]);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [simulation, setSimulation] = useState<Simulation | null>(null);
  const [selectedMemberId, setSelectedMemberId] = useState("");
  const [editingScore, setEditingScore] = useState<Score | null>(null);
  const [editingCharity, setEditingCharity] = useState<Charity | null>(null);

  function tell(value: string) {
    setNotice(value);
    window.setTimeout(() => setNotice(""), 6500);
  }

  async function load() {
    const [profileResult, charityResult, drawResult, winnerResult, subscriptionResult, donationResult, scoreResult, entryResult, eventResult] = await Promise.all([
      supabase.from("profiles").select("id,full_name,role,created_at").order("created_at", { ascending: false }),
      supabase.from("charities").select("id,name,slug,description,image_url,is_featured").order("is_featured", { ascending: false }),
      supabase.from("draws").select("id,label,status,mode,draw_date,prize_pool,rollover_jackpot,winning_numbers").order("draw_date", { ascending: false }),
      supabase.from("winners").select("id,user_id,draw_id,match_count,prize_amount,payout_status,proof_url").order("created_at", { ascending: false }),
      supabase.from("subscriptions").select("id,user_id,plan,status,current_period_end"),
      supabase.from("donations").select("id,amount,charity_id,created_at").order("created_at", { ascending: false }),
      supabase.from("scores").select("id,user_id,score_date,stableford_points").order("score_date", { ascending: false }),
      supabase.from("draw_entries").select("id,user_id,draw_id,numbers"),
      supabase.from("charity_events").select("id,charity_id,title,event_date,location,description").order("event_date", { ascending: true }),
    ]);
    const firstError = [profileResult, charityResult, drawResult, winnerResult, subscriptionResult, donationResult, scoreResult, entryResult, eventResult].find((result) => result.error)?.error;
    if (firstError) tell(`Some administration data could not load: ${firstError.message}`);
    setProfiles(profileResult.data || []);
    setCharities(charityResult.data || []);
    setDraws(drawResult.data || []);
    setWinners(winnerResult.data || []);
    setSubscriptions(subscriptionResult.data || []);
    setDonations(donationResult.data || []);
    setScores(scoreResult.data || []);
    setEntries(entryResult.data || []);
    setEvents(eventResult.data || []);
  }

  useEffect(() => { load(); }, []);

  const activeMembers = useMemo(() => new Set(subscriptions.filter(isCurrentSubscription).map((item) => item.user_id)).size, [subscriptions]);
  const reviewTotal = winners.filter((item) => item.payout_status === "under_review").length;
  const prizeTotal = draws.filter((item) => item.status === "draft").reduce((sum, item) => sum + Number(item.prize_pool), 0);
  const donationTotal = useMemo(() => donations.reduce((sum, item) => sum + Number(item.amount), 0), [donations]);
  const estimatedPrizePool = activeMembers * fixedPrizeContribution;
  const selectedMember = profiles.find((item) => item.id === selectedMemberId);
  const selectedMemberScores = scores.filter((item) => item.user_id === selectedMemberId);
  const profileName = (id: string) => profiles.find((item) => item.id === id)?.full_name || "Member";
  const drawName = (id: string) => draws.find((item) => item.id === id)?.label || "Draw";
  const charityName = (id: string) => charities.find((item) => item.id === id)?.name || "Unassigned cause";

  async function generateFor(draw: Draw) {
    if (draw.mode !== "algorithmic") return simulateDraw();
    const { data, error } = await supabase.from("scores").select("stableford_points");
    if (error) throw new Error(`Unable to load score frequency: ${error.message}`);
    return simulateWeightedDraw((data || []).map((item) => item.stableford_points));
  }

  async function createDraw(formData: FormData) {
    setBusy(true);
    const label = String(formData.get("label"));
    const mode = String(formData.get("mode"));
    const drawDate = new Date(String(formData.get("drawDate"))).toISOString();
    const topUp = Number(formData.get("topUp") || 0);
    const { error } = await supabase.rpc("create_draw", { p_label: label, p_mode: mode, p_draw_date: drawDate, p_prize_pool: topUp });
    setBusy(false);
    if (error) tell(error.message);
    else {
      tell("Draft draw created. Its prize pool includes the automatic per-active-member contribution and any optional top-up.");
      await load();
    }
  }

  async function publishDraw(draw: Draw) {
    if (!window.confirm(`Publish ${draw.label}? This permanently writes the winning numbers and creates winner records.`)) return;
    setBusy(true);
    try {
      if (simulation?.drawId !== draw.id) throw new Error("Run a simulation for this draw before publishing.");
      const winning = simulation.numbers;
      const { data, error } = await supabase.rpc("publish_draw", { p_draw_id: draw.id, p_winning_numbers: winning });
      if (error) throw new Error(error.message);
      const result = data as { winner_count?: number; next_jackpot?: number } | null;
      tell(`${draw.label} published with ${result?.winner_count || 0} winner(s). Next jackpot: ${formatINR(Number(result?.next_jackpot || 0), 2)}.`);
      setSimulation(null);
      await load();
    } catch (error) {
      tell(error instanceof Error ? error.message : "The draw could not be published.");
    } finally {
      setBusy(false);
    }
  }

  async function saveMemberProfile(formData: FormData) {
    const userId = String(formData.get("userId"));
    const fullName = String(formData.get("fullName")).trim();
    const role = String(formData.get("role"));
    if (fullName.length < 2) {
      tell("A member name must contain at least two characters.");
      return;
    }
    const { error } = await supabase.from("profiles").update({ full_name: fullName, role }).eq("id", userId);
    if (error) tell(error.message);
    else {
      tell("Member profile updated.");
      await load();
    }
  }

  async function saveMemberScore(formData: FormData) {
    const userId = String(formData.get("userId"));
    const scoreId = String(formData.get("scoreId") || "");
    const scoreDate = String(formData.get("scoreDate"));
    const points = Number(formData.get("points"));
    if (!userId || !scoreDate || !Number.isInteger(points) || points < 1 || points > 45) {
      tell("Enter a valid score date and a Stableford value from 1 to 45.");
      return;
    }
    const payload = { score_date: scoreDate, stableford_points: points };
    const { error } = scoreId
      ? await supabase.from("scores").update(payload).eq("id", scoreId)
      : await supabase.from("scores").insert({ user_id: userId, ...payload });
    if (error) tell(error.message);
    else {
      setEditingScore(null);
      tell(scoreId ? "Member score updated." : "Member score added.");
      await load();
    }
  }

  async function removeMemberScore(score: Score) {
    if (!window.confirm("Delete this member score?")) return;
    const { error } = await supabase.from("scores").delete().eq("id", score.id);
    if (error) tell(error.message);
    else {
      tell("Member score deleted.");
      await load();
    }
  }

  async function updateSubscription(id: string, status: string) {
    const { error } = await supabase.from("subscriptions").update({ status }).eq("id", id);
    if (error) tell(error.message);
    else {
      tell("Subscription status updated.");
      await load();
    }
  }

  async function grantTestMembership(userId: string) {
    const { error } = await supabase.from("subscriptions").insert({
      user_id: userId,
      plan: "monthly",
      status: "active",
      current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    });
    if (error) tell(error.message);
    else {
      tell("A 30-day test membership has been granted.");
      await load();
    }
  }

  async function saveCharity(formData: FormData) {
    const name = String(formData.get("name")).trim();
    const slug = String(formData.get("slug")).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    const description = String(formData.get("description")).trim();
    const imageUrl = String(formData.get("imageUrl")).trim() || null;
    const isFeatured = Boolean(formData.get("featured"));
    if (!name || !slug || !description) {
      tell("Name, URL slug, and description are required for a charity listing.");
      return;
    }
    const payload = { name, slug, description, image_url: imageUrl, is_featured: isFeatured };
    const { error } = editingCharity
      ? await supabase.from("charities").update(payload).eq("id", editingCharity.id)
      : await supabase.from("charities").insert(payload);
    if (error) tell(error.message);
    else {
      tell(editingCharity ? "Charity listing updated." : "Charity added to the public directory.");
      setEditingCharity(null);
      await load();
    }
  }

  async function toggleFeatured(item: Charity) {
    const { error } = await supabase.from("charities").update({ is_featured: !item.is_featured }).eq("id", item.id);
    if (error) tell(error.message);
    else await load();
  }

  async function removeCharity(item: Charity) {
    if (!window.confirm(`Delete ${item.name}? This also removes its listed events.`)) return;
    const { error } = await supabase.from("charities").delete().eq("id", item.id);
    if (error) tell(error.message);
    else {
      tell("Charity deleted.");
      if (editingCharity?.id === item.id) setEditingCharity(null);
      await load();
    }
  }

  async function createEvent(formData: FormData) {
    const charityId = String(formData.get("charityId"));
    const title = String(formData.get("title")).trim();
    const eventDate = String(formData.get("eventDate")) || null;
    const location = String(formData.get("location")).trim() || null;
    const description = String(formData.get("description")).trim() || null;
    if (!charityId || !title) {
      tell("Choose a charity and add an event title.");
      return;
    }
    const { error } = await supabase.from("charity_events").insert({ charity_id: charityId, title, event_date: eventDate, location, description });
    if (error) tell(error.message);
    else {
      tell("Charity event added.");
      await load();
    }
  }

  async function removeEvent(event: CharityEvent) {
    if (!window.confirm(`Delete ${event.title}?`)) return;
    const { error } = await supabase.from("charity_events").delete().eq("id", event.id);
    if (error) tell(error.message);
    else {
      tell("Charity event deleted.");
      await load();
    }
  }

  async function updatePayout(id: string, status: string) {
    const { error } = await supabase.rpc("review_winner", { p_winner_id: id, p_status: status });
    if (error) tell(error.message);
    else {
      tell("Winner payout status updated.");
      await load();
    }
  }

  async function openProof(item: Winner) {
    if (!item.proof_url) return;
    const { data, error } = await supabase.storage.from("winner-proofs").createSignedUrl(item.proof_url, 60);
    if (error) tell(error.message);
    else window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  const drawStats = draws.map((draw) => ({ draw, entries: entries.filter((entry) => entry.draw_id === draw.id).length, winners: winners.filter((winner) => winner.draw_id === draw.id).length }));
  const charityTotals = charities.map((charity) => ({ charity, total: donations.filter((donation) => donation.charity_id === charity.id).reduce((sum, donation) => sum + Number(donation.amount), 0) })).filter((item) => item.total > 0);

  return <>
    <section className="metric-grid">
      <article className="metric"><small>ACTIVE MEMBERS</small><b>{activeMembers}</b><small>Active and within their renewal period</small></article>
      <article className="metric"><small>OPEN PRIZE POOL</small><b>{formatINR(prizeTotal)}</b><small>{formatINR(estimatedPrizePool)} auto-estimate per open monthly cycle</small></article>
      <article className="metric"><small>CHARITY IMPACT</small><b>{formatINR(donationTotal)}</b><small>Settled donation-ledger total</small></article>
      <article className="metric"><small>REVIEW QUEUE</small><b>{reviewTotal}</b><small>Winner proofs awaiting review</small></article>
    </section>
    <div className="admin-tabs">{tabs.map((item) => <button key={item.id} className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)}>{item.label}</button>)}</div>

    {tab === "overview" && <section className="admin-grid">
      <article className="dashboard-section"><p className="eyebrow">DRAW CONTROL</p><h2>Run a safe simulation</h2><p className="panel-copy">This random preview creates no records. Each draft uses either a random process or a score-frequency weighted process, then requires a separate, auditable publication.</p><div className="admin-action-row"><button className="button" onClick={() => setSimulation({ drawId: "preview", numbers: simulateDraw() })}>Generate random preview</button>{simulation?.drawId === "preview" && <b className="simulation-numbers">{simulation.numbers.map((item) => String(item).padStart(2, "0")).join(" · ")}</b>}</div></article>
      <article className="dashboard-section"><p className="eyebrow">OPERATIONS QUEUE</p><h2>What needs attention</h2><p className="panel-copy">{reviewTotal ? `${reviewTotal} winner proof${reviewTotal === 1 ? " is" : "s are"} waiting for review.` : "No winner proof is waiting for review."}</p><div className="admin-action-row"><button className="button button--secondary" onClick={() => setTab("winners")}>Open verification queue</button><button className="button button--secondary" onClick={() => setTab("reports")}>Open reports</button></div></article>
    </section>}

    {tab === "members" && <>
      <section className="dashboard-section"><div className="dashboard-section__head"><div><p className="eyebrow">USER MANAGEMENT</p><h2>Members & subscriptions</h2></div><p>View and edit member profiles, grant test access, manage subscription states, and open the score-management surface.</p></div><table className="data-table"><thead><tr><th>Member</th><th>Role</th><th>Plan</th><th>Access</th><th /></tr></thead><tbody>{profiles.map((profile) => { const sub = subscriptions.find((item) => item.user_id === profile.id); return <tr key={profile.id}><td>{profile.full_name}</td><td>{profile.role}</td><td>{sub?.plan || "No plan"}</td><td>{sub ? <select className="status-select" value={sub.status} onChange={(event) => updateSubscription(sub.id, event.target.value)}><option value="active">active</option><option value="past_due">past due</option><option value="cancelled">cancelled</option><option value="lapsed">lapsed</option></select> : <button className="proof-link" onClick={() => grantTestMembership(profile.id)}>Grant test access</button>}</td><td><button className="proof-link" onClick={() => { setSelectedMemberId(profile.id); setEditingScore(null); }}>Manage</button></td></tr>; })}</tbody></table>{!profiles.length && <p className="empty-copy">No registered members yet.</p>}</section>
      {selectedMember && <section className="admin-grid member-editor"><article className="dashboard-section"><p className="eyebrow">PROFILE EDITOR</p><h2>{selectedMember.full_name}</h2><form className="admin-form" action={saveMemberProfile}><input type="hidden" name="userId" value={selectedMember.id} /><label>Full name<input name="fullName" defaultValue={selectedMember.full_name} key={`name-${selectedMember.id}`} required /></label><label>Role<select name="role" defaultValue={selectedMember.role} key={`role-${selectedMember.id}`}><option value="member">member</option><option value="admin">admin</option></select></label><button className="button">Save member profile</button></form></article><article className="dashboard-section"><p className="eyebrow">SCORE MANAGEMENT</p><h2>Golf scores</h2><div className="admin-score-list">{selectedMemberScores.map((score) => <div key={score.id}><span>{score.score_date} · <b>{score.stableford_points}</b> Stableford</span><div><button className="proof-link" onClick={() => setEditingScore(score)}>Edit</button><button className="text-danger" onClick={() => removeMemberScore(score)}>Delete</button></div></div>)}{!selectedMemberScores.length && <p className="empty-copy">No scores recorded for this member.</p>}</div><form className="admin-form compact-form" action={saveMemberScore}><input type="hidden" name="userId" value={selectedMember.id} /><input type="hidden" name="scoreId" value={editingScore?.id || ""} /><div className="split"><label>Date<input name="scoreDate" type="date" defaultValue={editingScore?.score_date || ""} key={`date-${editingScore?.id || "new"}`} required /></label><label>Stableford<input name="points" type="number" min="1" max="45" defaultValue={editingScore?.stableford_points || ""} key={`score-${editingScore?.id || "new"}`} required /></label></div><div className="admin-action-row"><button className="button">{editingScore ? "Update score" : "Add score"}</button>{editingScore && <button type="button" className="button button--secondary" onClick={() => setEditingScore(null)}>Cancel</button>}</div></form></article></section>}
    </>}

    {tab === "draws" && <section className="admin-grid"><article className="dashboard-section"><p className="eyebrow">CREATE MONTHLY DRAW</p><h2>Open a new draw</h2><p className="panel-copy">The base pool is calculated automatically as {formatINR(fixedPrizeContribution)} per active member: {activeMembers} × {formatINR(fixedPrizeContribution)} = <b>{formatINR(estimatedPrizePool)}</b>. You can add an optional bonus top-up.</p><form className="admin-form" action={createDraw}><label>Draw label<input name="label" required placeholder="October 2026 draw" /></label><div className="split"><label>Draw mode<select name="mode" defaultValue="random"><option value="random">Random</option><option value="algorithmic">Algorithmic (score-frequency weighted)</option></select></label><label>Draw date<input name="drawDate" type="datetime-local" required /></label></div><label>Optional bonus pool (₹)<input name="topUp" type="number" min="0" step="1" defaultValue="0" /></label><button className="button" disabled={busy}>Create draft draw</button></form></article><article className="dashboard-section"><p className="eyebrow">DRAW LOG</p><h2>Simulate & publish</h2><div className="draw-admin-list">{draws.map((item) => <div key={item.id}><b>{item.label}</b><span>{item.mode} · {item.status} · {formatINR(Number(item.prize_pool), 2)}{Number(item.rollover_jackpot) ? ` + ${formatINR(Number(item.rollover_jackpot), 2)} rollover` : ""}</span>{item.winning_numbers?.length ? <small>Winning: {item.winning_numbers.join(" · ")}</small> : <div className="admin-action-row"><button className="button button--secondary" onClick={async () => { try { setSimulation({ drawId: item.id, numbers: await generateFor(item) }); } catch (error) { tell(error instanceof Error ? error.message : "The simulation could not run."); } }}>Simulate</button><button className="button" disabled={busy} onClick={() => publishDraw(item)}>Publish</button>{simulation?.drawId === item.id && <small>Preview: {simulation.numbers.map((number) => String(number).padStart(2, "0")).join(" · ")}</small>}</div>}</div>)}</div>{!draws.length && <p className="empty-copy">Create the first monthly draw to begin.</p>}</article></section>}

    {tab === "charities" && <section className="admin-grid"><article className="dashboard-section"><p className="eyebrow">CHARITY MANAGEMENT</p><h2>{editingCharity ? "Edit cause" : "Add a cause"}</h2><form className="admin-form" action={saveCharity} key={editingCharity?.id || "new"}><label>Name<input name="name" required defaultValue={editingCharity?.name || ""} placeholder="Example Foundation" /></label><label>URL slug<input name="slug" required defaultValue={editingCharity?.slug || ""} placeholder="example-foundation" /></label><label>Description<textarea name="description" required defaultValue={editingCharity?.description || ""} placeholder="A short, compelling cause description." /></label><label>Image URL (optional)<input name="imageUrl" type="url" defaultValue={editingCharity?.image_url || ""} placeholder="https://…" /></label><label className="checkbox-label"><input type="checkbox" name="featured" defaultChecked={editingCharity?.is_featured || false} /> Feature on homepage</label><div className="admin-action-row"><button className="button">{editingCharity ? "Save charity" : "Add charity"}</button>{editingCharity && <button type="button" className="button button--secondary" onClick={() => setEditingCharity(null)}>Cancel</button>}</div></form></article><article className="dashboard-section"><p className="eyebrow">DIRECTORY CONTENT</p><h2>Published causes</h2><div className="charity-admin-list">{charities.map((item) => <div key={item.id}><b>{item.name}</b><p>{item.description}</p>{item.image_url && <small>Image: {item.image_url}</small>}<div className="admin-action-row"><button className="button button--secondary" onClick={() => setEditingCharity(item)}>Edit</button><button className="button button--secondary" onClick={() => toggleFeatured(item)}>{item.is_featured ? "Remove feature" : "Make featured"}</button><button className="text-danger" onClick={() => removeCharity(item)}>Delete</button></div></div>)}</div></article><article className="dashboard-section"><p className="eyebrow">EVENTS & UPDATES</p><h2>Add charity activity</h2><form className="admin-form" action={createEvent}><label>Charity<select name="charityId" required><option value="">Select a cause</option>{charities.map((charity) => <option key={charity.id} value={charity.id}>{charity.name}</option>)}</select></label><label>Event title<input name="title" required placeholder="Community golf day" /></label><div className="split"><label>Date<input name="eventDate" type="date" /></label><label>Location<input name="location" placeholder="City or club" /></label></div><label>Description<textarea name="description" placeholder="Optional event details" /></label><button className="button">Add event</button></form></article><article className="dashboard-section"><p className="eyebrow">EVENT LIST</p><h2>Live content</h2><div className="charity-admin-list">{events.map((event) => <div key={event.id}><b>{event.title}</b><p>{charityName(event.charity_id)} · {event.event_date || "Date TBA"}{event.location ? ` · ${event.location}` : ""}</p>{event.description && <small>{event.description}</small>}<button className="text-danger" onClick={() => removeEvent(event)}>Delete event</button></div>)}{!events.length && <p className="empty-copy">No events have been published yet.</p>}</div></article></section>}

    {tab === "winners" && <section className="dashboard-section"><div className="dashboard-section__head"><div><p className="eyebrow">WINNER VERIFICATION</p><h2>Proof & payouts</h2></div><p>Review submitted evidence, approve it, then record payment completion.</p></div><table className="data-table"><thead><tr><th>Member</th><th>Draw</th><th>Match</th><th>Prize</th><th>Proof</th><th>Payout</th></tr></thead><tbody>{winners.map((item) => <tr key={item.id}><td>{profileName(item.user_id)}</td><td>{drawName(item.draw_id)}</td><td>{item.match_count} match</td><td>{formatINR(Number(item.prize_amount), 2)}</td><td>{item.proof_url ? <button type="button" className="proof-link" onClick={() => openProof(item)}>Open proof</button> : "Awaiting"}</td><td><select className="status-select" value={item.payout_status} onChange={(event) => updatePayout(item.id, event.target.value)}>{(payoutTransitions[item.payout_status] || [item.payout_status]).map((status) => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}</select></td></tr>)}</tbody></table>{!winners.length && <p className="empty-copy">No draw winners have been generated yet.</p>}</section>}

    {tab === "reports" && <section className="reports-stack"><section className="report-grid"><article className="metric"><small>TOTAL USERS</small><b>{profiles.length}</b><small>{activeMembers} currently active</small></article><article className="metric"><small>TOTAL PRIZE POOL</small><b>{formatINR(prizeTotal)}</b><small>Across draft and published draws</small></article><article className="metric"><small>CHARITY CONTRIBUTIONS</small><b>{formatINR(donationTotal)}</b><small>Settled ledger entries</small></article><article className="metric"><small>DRAW ENTRIES</small><b>{entries.length}</b><small>{winners.length} winning records</small></article></section><section className="dashboard-section"><div className="dashboard-section__head"><div><p className="eyebrow">DRAW STATISTICS</p><h2>Entries, winners & pool</h2></div><p>Use this operational snapshot before you communicate published results.</p></div><table className="data-table"><thead><tr><th>Draw</th><th>Status</th><th>Entries</th><th>Winners</th><th>Pool</th></tr></thead><tbody>{drawStats.map(({ draw, entries: drawEntries, winners: drawWinners }) => <tr key={draw.id}><td>{draw.label}</td><td>{draw.status}</td><td>{drawEntries}</td><td>{drawWinners}</td><td>{formatINR(Number(draw.prize_pool), 2)}</td></tr>)}</tbody></table>{!drawStats.length && <p className="empty-copy">No draws have been created yet.</p>}</section><section className="dashboard-section"><div className="dashboard-section__head"><div><p className="eyebrow">CHARITY CONTRIBUTION TOTALS</p><h2>Where impact is landing</h2></div><p>Totals are derived from settled Stripe webhook records, not dashboard estimates.</p></div>{charityTotals.length ? <div className="mini-list">{charityTotals.map(({ charity, total }) => <div key={charity.id}><b>{charity.name}</b><span>{formatINR(total, 2)}</span></div>)}</div> : <p className="empty-copy">No settled contributions yet.</p>}</section></section>}
    {notice && <p className="toast-message" role="status">{notice}</p>}
  </>;
}
