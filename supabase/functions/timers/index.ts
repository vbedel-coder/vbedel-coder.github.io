// Appelé toutes les 15 s : envoie une notification (avec sonnerie) à chaque minuteur terminé, puis la répète chaque minute pendant 5 min tant qu'il n'est pas arrêté.
// Alerte de commande au moulin (calculée par l'appli, rubrique ordA) : une notification à 8 h le jour du mail (une semaine avant la livraison du mardi), répétée chaque matin pendant 7 jours tant que la commande n'est pas copiée.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "jsr:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
webpush.setVapidDetails("https://vbedel-coder.github.io", Deno.env.get("VAPID_PUBLIC")!, Deno.env.get("VAPID_PRIVATE")!);

type Timer = { k: string; n: string; end: number; cnt?: number };
type OrdA = { at?: number; txt?: string };

Deno.serve(async () => {
  const now = Date.now();
  const { data: rows, error } = await sb.from("state").select("id, timers:data->timers, ordA:data->ordA");
  if (error) return new Response(error.message, { status: 500 });
  let sent = 0;
  const send = async (uid: string, payload: Record<string, string>, ttl: number) => {
    const { data: subs } = await sb.from("push_subs").select("endpoint, sub").eq("user_id", uid);
    for (const s of subs ?? []) {
      try { await webpush.sendNotification(s.sub, JSON.stringify(payload), { TTL: ttl, urgency: "high" }); sent++; }
      catch (e) { const c = (e as { statusCode?: number }).statusCode; if (c === 404 || c === 410) await sb.from("push_subs").delete().eq("endpoint", s.endpoint); }
    }
  };
  for (const row of rows ?? []) {
    const o = (row.ordA ?? {}) as OrdA;
    if (typeof o.at === "number" && now >= o.at && now < o.at + 7 * 86400000) {
      const n = Math.floor((now - o.at) / 86400000);
      const { data: ins } = await sb.from("push_sent").upsert({ user_id: row.id, k: "moulin", end_ms: o.at, n }, { onConflict: "user_id,k,end_ms,n", ignoreDuplicates: true }).select();
      if (ins?.length) await send(row.id, { title: "Commande au moulin", body: o.txt || "Commande de farines à passer", tag: "moulin", url: "./?stock" }, 43200);
    }
    const timers: Timer[] = Array.isArray(row.timers) ? row.timers : [];
    for (const t of timers) {
      const late = now - t.end;
      if (!(late >= 0 && late < 6 * 60000)) continue;
      const n = Math.floor(late / 60000);
      const { data: ins } = await sb.from("push_sent").upsert({ user_id: row.id, k: t.k, end_ms: t.end, n }, { onConflict: "user_id,k,end_ms,n", ignoreDuplicates: true }).select();
      if (!ins?.length) continue;
      await send(row.id, { title: t.n, body: n ? "Minuteur terminé depuis " + n + " min" : "Minuteur terminé", tag: "tm-" + t.k }, 300);
    }
  }
  await sb.from("push_sent").delete().lt("at", new Date(now - 8 * 86400000).toISOString());
  return new Response(JSON.stringify({ sent }), { headers: { "Content-Type": "application/json" } });
});
