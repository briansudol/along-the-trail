-- Along the Trail — Supabase schema
-- Run in the SQL editor of a new Supabase project (Dashboard → SQL).
-- Then create a public storage bucket named community-photos
-- (or run the storage insert below).

create table if not exists public.community_uploads (
  id text primary key,
  created_at timestamptz not null default now(),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  location text,
  notes text,
  lat double precision,
  lon double precision,
  image_url text,
  payload jsonb not null default '{}'::jsonb
);

create index if not exists community_uploads_status_idx
  on public.community_uploads (status, created_at desc);

create table if not exists public.newsletter_signups (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  consented_at timestamptz not null default now(),
  source text default 'site'
);

create table if not exists public.admin_settings (
  key text primary key,
  value text not null
);

-- Set this to the same value as TRAIL_BACKEND.moderateSecret
-- (localhost admin uses it to approve/reject uploads).
-- insert into public.admin_settings (key, value)
-- values ('moderate_secret', 'change-me')
-- on conflict (key) do update set value = excluded.value;

alter table public.community_uploads enable row level security;
alter table public.newsletter_signups enable row level security;
alter table public.admin_settings enable row level security;

drop policy if exists "public insert pending uploads" on public.community_uploads;
create policy "public insert pending uploads"
  on public.community_uploads
  for insert
  to anon, authenticated
  with check (status = 'pending');

drop policy if exists "public read approved uploads" on public.community_uploads;
create policy "public read approved uploads"
  on public.community_uploads
  for select
  to anon, authenticated
  using (status = 'approved');

drop policy if exists "public insert newsletter" on public.newsletter_signups;
create policy "public insert newsletter"
  on public.newsletter_signups
  for insert
  to anon, authenticated
  with check (email ~* '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$');

-- No public read on newsletter or admin_settings.

create or replace function public.moderate_upload(
  p_id text,
  p_status text,
  p_secret text,
  p_payload jsonb default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  stored text;
  row public.community_uploads;
begin
  if p_status not in ('approved', 'rejected') then
    raise exception 'status must be approved or rejected';
  end if;
  select value into stored from public.admin_settings where key = 'moderate_secret';
  if stored is null or stored = '' or stored is distinct from p_secret then
    raise exception 'Unauthorized';
  end if;
  update public.community_uploads
     set status = p_status,
         payload = coalesce(p_payload, payload)
   where id = p_id
   returning * into row;
  if row.id is null then
    raise exception 'Upload not found';
  end if;
  return json_build_object('ok', true, 'id', row.id, 'status', row.status, 'payload', row.payload);
end;
$$;

create or replace function public.list_upload_inbox(p_secret text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  stored text;
  result json;
begin
  select value into stored from public.admin_settings where key = 'moderate_secret';
  if stored is null or stored = '' or stored is distinct from p_secret then
    raise exception 'Unauthorized';
  end if;
  select coalesce(json_agg(row_to_json(u) order by u.created_at desc), '[]'::json)
    into result
    from public.community_uploads u
   where u.status in ('pending', 'rejected');
  return result;
end;
$$;

create or replace function public.list_newsletter(p_secret text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  stored text;
  result json;
begin
  select value into stored from public.admin_settings where key = 'moderate_secret';
  if stored is null or stored = '' or stored is distinct from p_secret then
    raise exception 'Unauthorized';
  end if;
  select coalesce(json_agg(json_build_object(
           'email', n.email,
           'consented_at', n.consented_at
         ) order by n.consented_at desc), '[]'::json)
    into result
    from public.newsletter_signups n;
  return result;
end;
$$;

grant execute on function public.moderate_upload(text, text, text, jsonb) to anon, authenticated;
grant execute on function public.list_upload_inbox(text) to anon, authenticated;
grant execute on function public.list_newsletter(text) to anon, authenticated;

-- Storage bucket (public so approved photos can render on GitHub Pages)
insert into storage.buckets (id, name, public)
values ('community-photos', 'community-photos', true)
on conflict (id) do nothing;

drop policy if exists "public read community photos" on storage.objects;
create policy "public read community photos"
  on storage.objects
  for select
  to anon, authenticated
  using (bucket_id = 'community-photos');

drop policy if exists "public upload community photos" on storage.objects;
create policy "public upload community photos"
  on storage.objects
  for insert
  to anon, authenticated
  with check (
    bucket_id = 'community-photos'
    and (storage.foldername(name))[1] = 'pending'
  );
