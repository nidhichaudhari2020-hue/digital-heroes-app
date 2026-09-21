import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DashboardClient } from "@/components/dashboard-client";
import { AppHeader } from "@/components/app-header";
export default async function Dashboard() { const supabase=await createClient();const {data:{user}}=await supabase.auth.getUser();if(!user)redirect("/auth");const {data:profile}=await supabase.from("profiles").select("full_name").eq("id",user.id).single();return <div className="app-shell"><AppHeader/><main className="app-container"><div className="app-heading"><div><p className="eyebrow">MEMBER DASHBOARD</p><h1>Good to see you, <em>{profile?.full_name?.split(" ")[0]||"member"}.</em></h1></div><span className="session-pill">● MEMBER SESSION</span></div><DashboardClient userId={user.id} name={profile?.full_name||"Member"}/></main></div>; }
