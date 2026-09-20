"use client";
import { useState } from "react";
import { addScore, type Score } from "@/lib/scores";

const initial: Score[] = [{date:"2026-09-12", points:38},{date:"2026-09-03",points:31},{date:"2026-08-28",points:35},{date:"2026-08-19",points:29},{date:"2026-08-04",points:33}];
export function ScoreForm() {
  const [scores,setScores]=useState(initial); const [message,setMessage]=useState("");
  function submit(form: FormData) { const result=addScore(scores,{date:String(form.get("date")),points:Number(form.get("points"))}); if("error" in result){setMessage(result.error);return} setScores(result.scores);setMessage("Score saved. Your rolling five-score entry is updated."); }
  return <section className="scores"><div className="eyebrow">YOUR LAST FIVE</div><h3>Form tracker</h3><p>Your five newest scores form your draw entry.</p><div className="score-list">{scores.map(s=><div className="score" key={s.date}>{s.points}<span>{new Date(s.date+"T00:00:00").toLocaleDateString("en-GB",{day:"2-digit",month:"short"})}</span></div>)}</div><form action={submit}><label>Date<input name="date" type="date" required /></label><label>Stableford score<input name="points" type="number" min="1" max="45" required placeholder="1-45" /></label><button className="button">Add score</button></form><div className="message">{message}</div></section>;
}
