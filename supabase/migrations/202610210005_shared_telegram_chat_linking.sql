drop index if exists public.profiles_telegram_chat_id_uidx;

create or replace function public.consume_telegram_link_code(
  p_token_hash text,
  p_chat_id text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  linked_profile_id uuid;
begin
  select profile_id
  into linked_profile_id
  from public.telegram_link_codes
  where token_hash = p_token_hash
    and used_at is null
    and expires_at > now()
  for update;

  if not found then
    return null;
  end if;

  update public.profiles
  set telegram_chat_id = p_chat_id
  where id = linked_profile_id;

  if not found then
    raise exception 'telegram_profile_not_found';
  end if;

  update public.telegram_link_codes
  set used_at = now()
  where token_hash = p_token_hash;

  return linked_profile_id;
end;
$$;

revoke all on function public.consume_telegram_link_code(text, text) from public, anon, authenticated;
grant execute on function public.consume_telegram_link_code(text, text) to service_role;
