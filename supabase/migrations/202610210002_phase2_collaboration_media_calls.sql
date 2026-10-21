create table if not exists public.door_members (
  door_id uuid not null references public.doors (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  role text not null check (role in ('owner', 'resident')),
  created_at timestamptz not null default now(),
  primary key (door_id, profile_id)
);

insert into public.door_members (door_id, profile_id, role)
select id, owner_id, 'owner'
from public.doors
on conflict (door_id, profile_id) do update set role = 'owner';

create or replace function public.add_door_owner_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.door_members (door_id, profile_id, role)
  values (new.id, new.owner_id, 'owner')
  on conflict (door_id, profile_id) do update set role = 'owner';
  return new;
end;
$$;

drop trigger if exists doors_add_owner_membership on public.doors;
create trigger doors_add_owner_membership
  after insert on public.doors
  for each row execute procedure public.add_door_owner_membership();

create or replace function public.can_access_door(target_door_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.door_members
    where door_id = target_door_id
      and profile_id = (select auth.uid())
  );
$$;

create or replace function public.can_manage_door(target_door_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.door_members
    where door_id = target_door_id
      and profile_id = (select auth.uid())
      and role = 'owner'
  );
$$;

create table if not exists public.door_invites (
  id uuid primary key default gen_random_uuid(),
  door_id uuid not null references public.doors (id) on delete cascade,
  email text not null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists door_invites_door_created_idx
  on public.door_invites (door_id, created_at desc);

alter table public.ring_events
  add column if not exists visitor_photo_path text,
  add column if not exists call_requested boolean not null default false;

create table if not exists public.door_calls (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null unique references public.ring_events (id) on delete cascade,
  door_id uuid not null references public.doors (id) on delete cascade,
  status text not null default 'ringing' check (status in ('ringing', 'accepted', 'rejected', 'ended', 'expired')),
  visitor_offer jsonb,
  resident_answer jsonb,
  visitor_candidates jsonb not null default '[]'::jsonb,
  resident_candidates jsonb not null default '[]'::jsonb,
  expires_at timestamptz not null default (now() + interval '15 minutes'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint door_calls_visitor_candidates_array check (jsonb_typeof(visitor_candidates) = 'array'),
  constraint door_calls_resident_candidates_array check (jsonb_typeof(resident_candidates) = 'array')
);

create index if not exists door_calls_door_created_idx
  on public.door_calls (door_id, created_at desc);

create table if not exists public.visitor_media_cleanup (
  path text primary key,
  queued_at timestamptz not null default now()
);

create or replace function public.queue_visitor_photo_cleanup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.visitor_photo_path is not null then
    insert into public.visitor_media_cleanup (path)
    values (old.visitor_photo_path)
    on conflict (path) do nothing;
  end if;
  return old;
end;
$$;

drop trigger if exists ring_events_queue_visitor_photo_cleanup on public.ring_events;
create trigger ring_events_queue_visitor_photo_cleanup
  before delete on public.ring_events
  for each row execute procedure public.queue_visitor_photo_cleanup();

alter table public.door_members enable row level security;
alter table public.door_invites enable row level security;
alter table public.door_calls enable row level security;
alter table public.visitor_media_cleanup enable row level security;

drop policy if exists "Residents can read their doors" on public.doors;
create policy "Residents can read their doors"
  on public.doors for select to authenticated
  using (public.can_access_door(id));

drop policy if exists "Residents can update their doors" on public.doors;
create policy "Door owners can update their doors"
  on public.doors for update to authenticated
  using (public.can_manage_door(id))
  with check (public.can_manage_door(id));

drop policy if exists "Door owners can create doors" on public.doors;
create policy "Door owners can create doors"
  on public.doors for insert to authenticated
  with check (owner_id = (select auth.uid()));

drop policy if exists "Residents can read events for their doors" on public.ring_events;
create policy "Residents can read events for their doors"
  on public.ring_events for select to authenticated
  using (public.can_access_door(door_id));

drop policy if exists "Residents can answer events for their doors" on public.ring_events;
create policy "Residents can answer events for their doors"
  on public.ring_events for update to authenticated
  using (public.can_access_door(door_id))
  with check (public.can_access_door(door_id));

drop policy if exists "Residents can read their door memberships" on public.door_members;
create policy "Residents can read their door memberships"
  on public.door_members for select to authenticated
  using (profile_id = (select auth.uid()) or public.can_manage_door(door_id));

drop policy if exists "Residents can read calls for their doors" on public.door_calls;
create policy "Residents can read calls for their doors"
  on public.door_calls for select to authenticated
  using (public.can_access_door(door_id));

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_slug text := left(replace(gen_random_uuid()::text, '-', ''), 10);
  new_door_id uuid;
begin
  insert into public.profiles (id) values (new.id);
  insert into public.doors (owner_id, name, slug)
  values (new.id, 'Mi puerta', new_slug)
  returning id into new_door_id;
  insert into public.door_members (door_id, profile_id, role)
  values (new_door_id, new.id, 'owner')
  on conflict (door_id, profile_id) do nothing;
  return new;
end;
$$;

revoke all on public.door_members, public.door_invites, public.door_calls, public.visitor_media_cleanup from anon, authenticated;
grant select (door_id, profile_id, role, created_at) on public.door_members to authenticated;
grant select (id, event_id, door_id, status, expires_at, created_at, updated_at)
  on public.door_calls to authenticated;
grant select (id, door_id, visitor_photo_path, call_requested)
  on public.ring_events to authenticated;
grant insert (owner_id, name, slug) on public.doors to authenticated;

revoke all on function public.can_access_door(uuid) from public, anon;
revoke all on function public.can_manage_door(uuid) from public, anon;
grant execute on function public.can_access_door(uuid) to authenticated, service_role;
grant execute on function public.can_manage_door(uuid) to authenticated, service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('visitor-photos', 'visitor-photos', false, 2097152, array['image/jpeg'])
on conflict (id) do update
set public = false, file_size_limit = 2097152, allowed_mime_types = array['image/jpeg'];

drop policy if exists "Residents can view photos for their doors" on storage.objects;
create policy "Residents can view photos for their doors"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'visitor-photos'
    and exists (
      select 1
      from public.ring_events
      where ring_events.visitor_photo_path = storage.objects.name
        and public.can_access_door(ring_events.door_id)
    )
  );

create or replace function public.cleanup_old_ring_events()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_count bigint;
begin
  delete from public.ring_events where created_at < now() - interval '30 days';
  get diagnostics deleted_count = row_count;
  delete from public.door_calls where expires_at < now();
  delete from public.door_invites where expires_at < now() or used_at is not null;
  return deleted_count;
end;
$$;
