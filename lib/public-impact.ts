import { createClient } from "@/lib/supabase/server";
export type PublicImpact = { donated: number; charities: number; draw: null | { label: string; status: string; prize_pool: number; jackpot: number; draw_date: string; numbers: number[] | null } };
export async function getPublicImpact(): Promise<PublicImpact | null> {
  try {
    const db = await createClient();
    const { data, error } = await db.rpc("public_impact_summary");
    return error ? null : data as PublicImpact;
  } catch { return null; }
}
