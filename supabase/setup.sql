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
