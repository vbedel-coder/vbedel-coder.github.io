-- Base de Vivant (relançable sans risque : chaque étape vérifie ce qui existe déjà). __REF__ est remplacé au déploiement.
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Toutes les données de l'appli : un document par compte, comme dans l'appli Claude
create table if not exists public.state(id uuid primary key references auth.users on delete cascade, data jsonb not null, updated_at timestamptz not null default now());
alter table public.state enable row level security;
drop policy if exists own on public.state;
create policy own on public.state for all to authenticated using (auth.uid()=id) with check (auth.uid()=id);

-- Appareils qui reçoivent les notifications de fin de minuteur
create table if not exists public.push_subs(endpoint text primary key, user_id uuid not null references auth.users on delete cascade, sub jsonb not null, created_at timestamptz not null default now());
alter table public.push_subs enable row level security;
drop policy if exists own on public.push_subs;
create policy own on public.push_subs for all to authenticated using (auth.uid()=user_id) with check (auth.uid()=user_id);

-- Notifications déjà envoyées (lu et écrit par le serveur seulement)
create table if not exists public.push_sent(user_id uuid not null, k text not null, end_ms bigint not null, n int not null, at timestamptz not null default now(), primary key(user_id,k,end_ms,n));
alter table public.push_sent enable row level security;

-- Réglages publics (clé publique des notifications)
create table if not exists public.config(k text primary key, v text not null);
alter table public.config enable row level security;
drop policy if exists pub on public.config;
create policy pub on public.config for select to anon, authenticated using (true);

-- Mises à jour en direct entre téléphone et iPad
do $$ begin alter publication supabase_realtime add table public.state; exception when duplicate_object then null; end $$;

-- Vérification des minuteurs toutes les 15 secondes
select cron.unschedule(jobid) from cron.job where jobname='vivant-timers';
select cron.schedule('vivant-timers','15 seconds',$job$ select net.http_post(url:='https://__REF__.supabase.co/functions/v1/timers',body:='{}'::jsonb,headers:='{"Content-Type":"application/json"}'::jsonb) $job$);

-- ---- Click and collect ----
-- Le compte de Vincent (le premier créé) : seul à pouvoir publier la carte et lire les commandes
create or replace function public.vivant_owner() returns uuid language sql stable security definer set search_path=public as $$ select id from auth.users order by created_at limit 1 $$;

revoke all on function public.vivant_owner() from public, anon;
grant execute on function public.vivant_owner() to authenticated, service_role;

-- Carte publiée par l'appli : ouverture, jours de retrait (heure limite de chaque produit), produits et prix (lecture publique)
create table if not exists public.shop(id int primary key default 1 check (id=1), data jsonb not null, updated_at timestamptz not null default now());
alter table public.shop enable row level security;
drop policy if exists pub on public.shop;
create policy pub on public.shop for select to anon, authenticated using (true);
drop policy if exists own on public.shop;
create policy own on public.shop for all to authenticated using (auth.uid()=public.vivant_owner()) with check (auth.uid()=public.vivant_owner());

-- Commandes passées sur la page publique (créées seulement par place_order, lues et modifiées par Vincent)
create table if not exists public.web_orders(id uuid primary key default gen_random_uuid(), created_at timestamptz not null default now(),
  pickup date not null, name text not null, phone text not null, note text not null default '', items jsonb not null, total numeric(8,2) not null,
  pay text not null default 'place', paid boolean not null default false, imported boolean not null default false, notified boolean not null default false);
alter table public.web_orders enable row level security;
drop policy if exists own on public.web_orders;
create policy own on public.web_orders for all to authenticated using (auth.uid()=public.vivant_owner()) with check (auth.uid()=public.vivant_owner());
do $$ begin alter publication supabase_realtime add table public.web_orders; exception when duplicate_object then null; end $$;

-- Prise de commande : tout est vérifié ici avec la carte (ouverture, heure limite, produits du jour, prix), le total est recalculé
create or replace function public.place_order(p_pickup date, p_name text, p_phone text, p_note text, p_items jsonb, p_pay text default 'place')
returns jsonb language plpgsql security definer set search_path=public as $$
declare s jsonb; d jsonb; k text; q numeric; pr jsonb; tot numeric:=0; clean jsonb:='{}'; n int:=0; oid uuid;
begin
  select data into s from shop where id=1;
  if s is null or not coalesce((s->>'open')::boolean,false) then raise exception 'ferme'; end if;
  d:=s->'days'->(p_pickup::text);
  if d is null then raise exception 'jour'; end if;
  if p_pay not in ('place','qonto') or (p_pay='qonto' and not coalesce((s->>'qonto')::boolean,false)) then raise exception 'paiement'; end if;
  p_name:=left(btrim(coalesce(p_name,'')),60); p_phone:=left(btrim(coalesce(p_phone,'')),20); p_note:=left(btrim(coalesce(p_note,'')),200);
  if length(p_name)<2 or length(regexp_replace(p_phone,'[^0-9]','','g'))<9 then raise exception 'contact'; end if;
  for k,q in select key,(value#>>'{}')::numeric from jsonb_each(coalesce(p_items,'{}')) loop
    if q is null or q<=0 then continue; end if;
    pr:=s->'products'->k;
    if pr is null or d->'items'->>k is null then raise exception 'produit'; end if;
    if now() > (d->'items'->>k)::timestamptz then raise exception 'tard'; end if;
    if q>(pr->>'max')::numeric or abs(q/(pr->>'step')::numeric-round(q/(pr->>'step')::numeric))>0.001 then raise exception 'quantite'; end if;
    clean:=clean||jsonb_build_object(k,q); tot:=tot+q/(pr->>'step')::numeric*(pr->>'price')::numeric; n:=n+1;
  end loop;
  if n=0 then raise exception 'vide'; end if;
  -- Pas plus de 3 commandes par téléphone et par jour de retrait
  if (select count(*) from web_orders where pickup=p_pickup and regexp_replace(phone,'[^0-9]','','g')=regexp_replace(p_phone,'[^0-9]','','g'))>=3 then raise exception 'limite'; end if;
  insert into web_orders(pickup,name,phone,note,items,total,pay) values(p_pickup,p_name,p_phone,p_note,clean,round(tot,2),p_pay) returning id into oid;
  return jsonb_build_object('id',oid,'total',round(tot,2));
end $$;
revoke all on function public.place_order(date,text,text,text,jsonb,text) from public;
grant execute on function public.place_order(date,text,text,text,jsonb,text) to anon, authenticated;
