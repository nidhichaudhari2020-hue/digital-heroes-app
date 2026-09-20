import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DashboardClient } from "@/components/dashboard-client";
import { MembershipButton } from "@/components/membership-button";
export default async function Dashboard() { const supabase=await createClient();const {data:{user}}=await supabase.auth.getUser();if(!user)redirect("/auth");const {data:profile}=await supabase.from("profiles").select("full_name").eq("id",user.id).single();return <main className="shell"><div className="page-title"><div><div className="eyebrow">MEMBER DASHBOARD</div><h1>Good to see you, <em>{profile?.full_name?.split(" ")[0]||"member"}.</em></h1></div><span className="status">● MEMBER SESSION</span></div><div className="plans"><MembershipButton plan="monthly"/><MembershipButton plan="yearly"/></div><DashboardClient userId={user.id} name={profile?.full_name||"Member"}/></main>; }
