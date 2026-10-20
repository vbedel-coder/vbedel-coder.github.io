// Appelé toutes les 15 s : envoie une notification (avec sonnerie) à chaque minuteur terminé, puis la répète 2 fois à 1 min d'écart tant qu'il n'est pas arrêté.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "jsr:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
webpush.setVapidDetails("https://vbedel-coder.github.io", Deno.env.get("VAPID_PUBLIC")!, Deno.env.get("VAPID_PRIVATE")!);

type Timer = { k: string; n: string; end: number; cnt?: number };

Deno.serve(async () => {
  const now = Date.now();
  const { data: rows, error } = await sb.from("state").select("id, timers:data->timers");
  if (error) return new Response(error.message, { status: 500 });
  let sent = 0;
  for (const row of rows ?? []) {
    const timers: Timer[] = Array.isArray(row.timers) ? row.timers : [];
    for (const t of timers) {
      const late = now - t.end;
      if (!(late >= 0 && late < 3 * 60000)) continue;
      const n = Math.floor(late / 60000);
      const { data: ins } = await sb.from("push_sent").upsert({ user_id: row.id, k: t.k, end_ms: t.end, n }, { onConflict: "user_id,k,end_ms,n", ignoreDuplicates: true }).select();
      if (!ins?.length) continue;
      const { data: subs } = await sb.from("push_subs").select("endpoint, sub").eq("user_id", row.id);
      const body = JSON.stringify({ title: t.n, body: n ? "Minuteur terminé depuis " + n + " min" : "Minuteur terminé", tag: "tm-" + t.k });
      for (const s of subs ?? []) {
        try { await webpush.sendNotification(s.sub, body, { TTL: 300, urgency: "high" }); sent++; }
        catch (e) { const c = (e as { statusCode?: number }).statusCode; if (c === 404 || c === 410) await sb.from("push_subs").delete().eq("endpoint", s.endpoint); }
      }
    }
  }
  await sb.from("push_sent").delete().lt("at", new Date(now - 86400000).toISOString());
  return new Response(JSON.stringify({ sent }), { headers: { "Content-Type": "application/json" } });
});
