create or replace function public.accept_door_invite(
  p_token_hash text,
  p_profile_id uuid,
  p_email text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  invitation public.door_invites%rowtype;
begin
  select *
  into invitation
  from public.door_invites
  where token_hash = p_token_hash
    and used_at is null
    and expires_at > now()
  for update;

  if not found then
    raise exception 'invite_invalid_or_expired';
  end if;

  if lower(invitation.email) <> lower(p_email) then
    raise exception 'invite_email_mismatch';
  end if;

  insert into public.door_members (door_id, profile_id, role)
  values (invitation.door_id, p_profile_id, 'resident')
  on conflict (door_id, profile_id) do nothing;

  update public.door_invites
  set used_at = now()
  where id = invitation.id;

  return invitation.door_id;
end;
$$;

revoke all on function public.accept_door_invite(text, uuid, text) from public, anon, authenticated;
grant execute on function public.accept_door_invite(text, uuid, text) to service_role;
