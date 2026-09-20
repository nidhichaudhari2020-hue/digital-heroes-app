import { z } from "zod";
export type Score = { date: string; points: number };
const scoreSchema=z.object({date:z.string().date(),points:z.number().int().min(1).max(45)});
export function addScore(current: Score[], candidate: Score): {scores: Score[]} | {error:string} {
  const parsed=scoreSchema.safeParse(candidate); if(!parsed.success) return {error:"Enter a unique date and a Stableford score from 1 to 45."};
  if(current.some(s=>s.date===candidate.date)) return {error:"A score already exists for that date. Edit or delete it instead."};
  return {scores:[...current,candidate].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,5)};
}
