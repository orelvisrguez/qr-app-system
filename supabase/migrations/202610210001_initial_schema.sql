create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  telegram_chat_id text,
  created_at timestamptz not null default now()
);

create table if not exists public.doors (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  name text not null default 'Mi puerta',
  slug text not null unique check (slug ~ '^[a-z0-9]{10}$'),
  active boolean not null default true,
  dnd_enabled boolean not null default false,
  dnd_start time,
  dnd_end time,
  quick_replies jsonb not null default '["Ya bajo","Esperá un momento","No estoy, dejá el paquete","No esperaba a nadie"]'::jsonb,
  created_at timestamptz not null default now(),
  constraint doors_dnd_hours check (
    not dnd_enabled or (dnd_start is not null and dnd_end is not null)
  ),
  constraint doors_quick_replies_array check (
    jsonb_typeof(quick_replies) = 'array'
    and jsonb_array_length(quick_replies) between 1 and 4
  )
);

create unique index if not exists profiles_telegram_chat_id_uidx
  on public.profiles (telegram_chat_id)
  where telegram_chat_id is not null;

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);

create table if not exists public.telegram_link_codes (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.ring_events (
  id uuid primary key default gen_random_uuid(),
  door_id uuid not null references public.doors (id) on delete cascade,
  visitor_name text check (visitor_name is null or char_length(visitor_name) <= 40),
  reason text check (reason is null or reason in ('Visita', 'Delivery', 'Paquete/Correo', 'Otro')),
  status text not null default 'pending' check (status in ('pending', 'answered', 'expired')),
  response_text text check (response_text is null or char_length(response_text) <= 60),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  ip_hash text not null,
  device_hash text not null
);

create index if not exists ring_events_door_created_idx
  on public.ring_events (door_id, created_at desc);
create index if not exists ring_events_device_created_idx
  on public.ring_events (device_hash, created_at desc);
create index if not exists ring_events_ip_created_idx
  on public.ring_events (ip_hash, created_at desc);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_slug text := left(replace(gen_random_uuid()::text, '-', ''), 10);
begin
  insert into public.profiles (id) values (new.id);
  insert into public.doors (owner_id, name, slug)
  values (new.id, 'Mi puerta', new_slug);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create or replace function public.create_ring(
  p_slug text,
  p_visitor_name text,
  p_reason text,
  p_ip_hash text,
  p_device_hash text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_door_id uuid;
  created_event_id uuid;
  lock_key text;
begin
  if p_reason is null or p_reason not in ('Visita', 'Delivery', 'Paquete/Correo', 'Otro') then
    raise exception using errcode = '22023', message = 'invalid_reason';
  end if;

  if p_ip_hash is null or p_device_hash is null then
    raise exception using errcode = '22023', message = 'invalid_request';
  end if;

  for lock_key in
    select value
    from unnest(array[p_ip_hash, p_device_hash]) as value
    order by value
  loop
    perform pg_advisory_xact_lock(hashtextextended(lock_key, 0));
  end loop;

  if exists (
    select 1
    from public.ring_events
    where device_hash = p_device_hash
      and created_at > now() - interval '30 seconds'
  ) then
    raise exception using errcode = 'P0001', message = 'rate_limit_device';
  end if;

  if (
    select count(*)
    from public.ring_events
    where ip_hash = p_ip_hash
      and created_at > now() - interval '1 hour'
  ) >= 5 then
    raise exception using errcode = 'P0001', message = 'rate_limit_ip';
  end if;

  select id into target_door_id
  from public.doors
  where slug = p_slug and active = true;

  if target_door_id is null then
    raise exception using errcode = 'P0001', message = 'door_unavailable';
  end if;

  insert into public.ring_events (door_id, visitor_name, reason, ip_hash, device_hash)
  values (target_door_id, nullif(left(trim(p_visitor_name), 40), ''), p_reason, p_ip_hash, p_device_hash)
  returning id into created_event_id;

  return created_event_id;
end;
$$;

revoke all on function public.create_ring(text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.create_ring(text, text, text, text, text) to service_role;

alter table public.profiles enable row level security;
alter table public.doors enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.telegram_link_codes enable row level security;
alter table public.ring_events enable row level security;

drop policy if exists "Residents can read their profile" on public.profiles;
create policy "Residents can read their profile"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()));

drop policy if exists "Residents can update their Telegram connection" on public.profiles;
create policy "Residents can update their Telegram connection"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

drop policy if exists "Residents can read their doors" on public.doors;
create policy "Residents can read their doors"
  on public.doors for select to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists "Residents can update their doors" on public.doors;
create policy "Residents can update their doors"
  on public.doors for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy if exists "Residents can read their push subscriptions" on public.push_subscriptions;
create policy "Residents can read their push subscriptions"
  on public.push_subscriptions for select to authenticated
  using (profile_id = (select auth.uid()));

drop policy if exists "Residents can manage their push subscriptions" on public.push_subscriptions;
create policy "Residents can manage their push subscriptions"
  on public.push_subscriptions for all to authenticated
  using (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()));

drop policy if exists "Residents can read events for their doors" on public.ring_events;
create policy "Residents can read events for their doors"
  on public.ring_events for select to authenticated
  using (
    exists (
      select 1 from public.doors
      where doors.id = ring_events.door_id
        and doors.owner_id = (select auth.uid())
    )
  );

drop policy if exists "Residents can answer events for their doors" on public.ring_events;
create policy "Residents can answer events for their doors"
  on public.ring_events for update to authenticated
  using (
    exists (
      select 1 from public.doors
      where doors.id = ring_events.door_id
        and doors.owner_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.doors
      where doors.id = ring_events.door_id
        and doors.owner_id = (select auth.uid())
    )
  );

revoke all on public.profiles, public.doors, public.push_subscriptions, public.telegram_link_codes, public.ring_events from anon, authenticated;
grant select on public.profiles, public.doors, public.push_subscriptions to authenticated;
grant update (telegram_chat_id) on public.profiles to authenticated;
grant update (name, active, dnd_enabled, dnd_start, dnd_end, quick_replies, slug)
  on public.doors to authenticated;
grant select (id, door_id, visitor_name, reason, status, response_text, created_at, responded_at)
  on public.ring_events to authenticated;
grant update (status, response_text, responded_at)
  on public.ring_events to authenticated;

alter table public.ring_events replica identity full;
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'ring_events'
  ) then
    alter publication supabase_realtime add table public.ring_events;
  end if;
end;
$$;

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
  return deleted_count;
end;
$$;

revoke all on function public.cleanup_old_ring_events() from public, anon, authenticated;
grant execute on function public.cleanup_old_ring_events() to service_role;
