// Appelé toutes les 15 s : envoie une notification (avec sonnerie) à chaque minuteur terminé, puis la répète chaque minute pendant 5 min tant qu'il n'est pas arrêté.
// Nouvelles commandes en ligne : une notification chacune.
// Commandes clients du jour : une notification 30 min avant l'ouverture (mardi 15h30, mercredi à vendredi 11h30, samedi 9h30) s'il reste des commandes à mettre de côté.
// Alerte de commande au moulin (calculée par l'appli, rubrique ordA) : une notification à 8 h le jour du mail (une semaine avant la livraison du mardi), répétée chaque matin pendant 7 jours tant que la commande n'est pas copiée.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "jsr:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
webpush.setVapidDetails("https://vbedel-coder.github.io", Deno.env.get("VAPID_PUBLIC")!, Deno.env.get("VAPID_PRIVATE")!);

type Timer = { k: string; n: string; end: number; cnt?: number };
type OrdA = { at?: number; txt?: string };
type Order = { date?: string; name?: string; items?: Record<string, number>; done?: boolean };
// Heure d'envoi (heure de Paris) par jour : 30 min avant l'ouverture de la boutique
const CMD_AT: Record<number, number> = { 2: 15.5, 3: 11.5, 4: 11.5, 5: 11.5, 6: 9.5 };
const NAMES: Record<string, string> = { froment: "Froment", epeautre: "Petit épeautre", khorasan: "Khorasan", fss: "Froment, seigle & sarrasin", focaccia: "Focaccia", graine: "Graine",
  meteil: "Méteil aux noix", chataigne: "Châtaigne", seigle: "Tourte de seigle", riz: "Riz & sarrasin", mie: "Pain de mie", brioche: "Brioche", blesAnciens: "Blés anciens", rugbrod: "Rugbrød", canele: "Canelé", nordique: "Nordique" };
const paris = (ms: number) => { const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, h: +p.hour + +p.minute / 60, wd: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday) }; };

Deno.serve(async () => {
  const now = Date.now();
  const { data: rows, error } = await sb.from("state").select("id, timers:data->timers, ordA:data->ordA, orders:data->orders, names:data->params->names");
  if (error) return new Response(error.message, { status: 500 });
  let sent = 0;
  const send = async (uid: string, payload: Record<string, string>, ttl: number) => {
    const { data: subs } = await sb.from("push_subs").select("endpoint, sub").eq("user_id", uid);
    for (const s of subs ?? []) {
      try { await webpush.sendNotification(s.sub, JSON.stringify(payload), { TTL: ttl, urgency: "high" }); sent++; }
      catch (e) { const c = (e as { statusCode?: number }).statusCode; if (c === 404 || c === 410) await sb.from("push_subs").delete().eq("endpoint", s.endpoint); }
    }
  };
  const pz = paris(now);
  for (const row of rows ?? []) {
    // Commandes du jour à mettre de côté (envoyée une seule fois par jour, dans les 3 h qui suivent l'heure prévue)
    const at = CMD_AT[pz.wd];
    if (at !== undefined && pz.h >= at && pz.h < at + 3) {
      const todo = ((Array.isArray(row.orders) ? row.orders : []) as Order[]).filter((x) => x.date === pz.date && !x.done);
      if (todo.length) {
        const day = Date.UTC(+pz.date.slice(0, 4), +pz.date.slice(5, 7) - 1, +pz.date.slice(8, 10));
        const { data: ins } = await sb.from("push_sent").upsert({ user_id: row.id, k: "cmdjour", end_ms: day, n: 0 }, { onConflict: "user_id,k,end_ms,n", ignoreDuplicates: true }).select();
        if (ins?.length) {
          const tot: Record<string, number> = {};
          todo.forEach((x) => Object.entries(x.items ?? {}).forEach(([k, q]) => { if (q > 0) tot[k] = (tot[k] ?? 0) + q; }));
          const nm = (row.names ?? {}) as Record<string, string>;
          const list = Object.entries(tot).map(([k, q]) => `${String(Math.round(q * 10) / 10).replace(".", ",")}${k === "focaccia" ? " kg" : ""} ${nm[k] || NAMES[k] || k}`).join(", ");
          await send(row.id, { title: `${todo.length} commande${todo.length > 1 ? "s" : ""} à mettre de côté`, body: list, tag: "cmdjour", url: "./?cmd=" + pz.date }, 10800);
        }
      }
    }
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
  // Commandes en ligne (click and collect) : une notification par nouvelle commande, qui ouvre les commandes du jour de retrait
  const { data: news } = await sb.from("web_orders").select("id, name, pickup, total, pay, paid").eq("notified", false);
  if (news?.length) {
    const { data: owner } = await sb.rpc("vivant_owner");
    for (const o of news) {
      const { data: upd } = await sb.from("web_orders").update({ notified: true }).eq("id", o.id).eq("notified", false).select("id");
      if (!upd?.length || !owner) continue;
      const day = new Date(o.pickup + "T12:00:00Z").toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Paris" });
      const eur = Number(o.total).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
      await send(owner as string, { title: "Nouvelle commande", body: `${o.name} · ${day} · ${eur}${o.paid ? " payée" : ""}`, tag: "cmd-" + o.id, url: "./?cmd=" + o.pickup }, 86400);
    }
  }
  await sb.from("push_sent").delete().lt("at", new Date(now - 8 * 86400000).toISOString());
  return new Response(JSON.stringify({ sent }), { headers: { "Content-Type": "application/json" } });
});
