-- TradeFlow Secure / Supabase schema
-- Run this once in Supabase SQL Editor on a NEW project.
-- Security model: authenticated users + workspace RLS + shipment-level access for external collaborators.

create extension if not exists pgcrypto;

create type public.member_role as enum ('admin', 'member', 'external');
create type public.shipment_direction as enum ('import', 'export');
create type public.transport_mode as enum ('air', 'sea');
create type public.shipment_status as enum ('normal', 'watch', 'risk', 'complete');
create type public.document_status as enum ('pending', 'requested', 'in_progress', 'complete', 'issue');
create type public.partner_kind as enum ('supplier', 'customer', 'forwarder', 'broker', 'other');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  created_at timestamptz not null default now()
);

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 100),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.member_role not null default 'member',
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table public.workspace_invites (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  invite_code text not null unique default upper(substr(encode(gen_random_bytes(16), 'hex'), 1, 20)),
  updated_at timestamptz not null default now()
);

create or replace function public.subtract_business_days(start_date date, days integer)
returns date
language plpgsql
immutable
as $$
declare
  result_date date := start_date;
  remaining integer := greatest(days, 0);
begin
  if start_date is null then return null; end if;
  while remaining > 0 loop
    result_date := result_date - 1;
    if extract(isodow from result_date) < 6 then
      remaining := remaining - 1;
    end if;
  end loop;
  return result_date;
end;
$$;

create table public.shipments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  reference_no text not null,
  direction public.shipment_direction not null default 'import',
  partner_name text not null default '',
  country text not null default '',
  item_name text not null default '',
  transport public.transport_mode not null default 'sea',
  cargo_ready_date date,
  etd date,
  eta date,
  document_lead_business_days integer not null default 0 check (document_lead_business_days between 0 and 60),
  document_deadline date generated always as (public.subtract_business_days(etd, document_lead_business_days)) stored,
  status public.shipment_status not null default 'normal',
  incoterm text,
  note text,
  owner_id uuid references public.profiles(id) on delete set null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id, reference_no)
);

create table public.shipment_access (
  shipment_id uuid not null references public.shipments(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key (shipment_id, user_id)
);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  shipment_id uuid not null references public.shipments(id) on delete cascade,
  doc_type text not null,
  status public.document_status not null default 'pending',
  storage_path text,
  original_name text,
  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(shipment_id, doc_type)
);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  shipment_id uuid not null references public.shipments(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 5000),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.activities (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  shipment_id uuid references public.shipments(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.partners (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  kind public.partner_kind not null default 'supplier',
  country text,
  email text,
  phone text,
  note text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.shipments add constraint shipments_id_workspace_key unique (id, workspace_id);
alter table public.shipment_access add constraint shipment_access_workspace_fk foreign key (shipment_id, workspace_id) references public.shipments(id, workspace_id) on delete cascade;
alter table public.documents add constraint documents_workspace_fk foreign key (shipment_id, workspace_id) references public.shipments(id, workspace_id) on delete cascade;
alter table public.comments add constraint comments_workspace_fk foreign key (shipment_id, workspace_id) references public.shipments(id, workspace_id) on delete cascade;

create index idx_members_user on public.workspace_members(user_id);
create index idx_shipments_workspace on public.shipments(workspace_id, created_at desc);
create index idx_shipments_dates on public.shipments(etd, eta);
create index idx_documents_shipment on public.documents(shipment_id);
create index idx_comments_shipment on public.comments(shipment_id, created_at desc);
create index idx_activities_workspace on public.activities(workspace_id, created_at desc);
create index idx_partners_workspace on public.partners(workspace_id, name);
create index idx_access_user on public.shipment_access(user_id);

-- Auth profile provisioning
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', split_part(coalesce(new.email, ''), '@', 1)))
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- RLS helper functions. SECURITY DEFINER prevents recursive membership policies.
create or replace function public.is_workspace_member(wid uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = wid and wm.user_id = auth.uid()
  );
$$;

create or replace function public.workspace_role(wid uuid)
returns public.member_role
language sql
stable
security definer set search_path = public
as $$
  select wm.role from public.workspace_members wm
  where wm.workspace_id = wid and wm.user_id = auth.uid()
  limit 1;
$$;

create or replace function public.can_access_shipment(sid uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1
    from public.shipments s
    join public.workspace_members wm on wm.workspace_id = s.workspace_id and wm.user_id = auth.uid()
    where s.id = sid
      and (
        wm.role in ('admin', 'member')
        or exists (
          select 1 from public.shipment_access sa
          where sa.shipment_id = s.id and sa.user_id = auth.uid()
        )
      )
  );
$$;

create or replace function public.can_view_profile(target_user uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select target_user = auth.uid() or exists (
    select 1
    from public.workspace_members me
    join public.workspace_members them on them.workspace_id = me.workspace_id
    where me.user_id = auth.uid()
      and me.role in ('admin','member')
      and them.user_id = target_user
  );
$$;

-- Workspace RPCs
create or replace function public.create_workspace(p_name text)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  wid uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  insert into public.workspaces(name, created_by) values (trim(p_name), auth.uid()) returning id into wid;
  insert into public.workspace_members(workspace_id, user_id, role) values (wid, auth.uid(), 'admin');
  insert into public.workspace_invites(workspace_id) values (wid);
  return wid;
end;
$$;

create or replace function public.join_workspace_by_code(p_code text)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  wid uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select workspace_id into wid from public.workspace_invites where invite_code = upper(trim(p_code));
  if wid is null then raise exception 'Invalid invite code'; end if;
  insert into public.workspace_members(workspace_id, user_id, role)
  values (wid, auth.uid(), 'member')
  on conflict (workspace_id, user_id) do nothing;
  return wid;
end;
$$;

create or replace function public.regenerate_invite_code(p_workspace uuid)
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  new_code text;
begin
  if public.workspace_role(p_workspace) <> 'admin' then raise exception 'Admin only'; end if;
  new_code := upper(substr(encode(gen_random_bytes(16), 'hex'), 1, 20));
  update public.workspace_invites set invite_code = new_code, updated_at = now() where workspace_id = p_workspace;
  return new_code;
end;
$$;

create or replace function public.set_member_role(p_workspace uuid, p_user uuid, p_role public.member_role)
returns void
language plpgsql
security definer set search_path = public
as $$
declare admin_count integer;
begin
  if public.workspace_role(p_workspace) <> 'admin' then raise exception 'Admin only'; end if;
  if p_user = auth.uid() and p_role <> 'admin' then
    select count(*) into admin_count from public.workspace_members where workspace_id = p_workspace and role = 'admin';
    if admin_count <= 1 then raise exception 'At least one admin is required'; end if;
  end if;
  update public.workspace_members set role = p_role where workspace_id = p_workspace and user_id = p_user;
end;
$$;

create or replace function public.duplicate_shipment(p_shipment uuid)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  src public.shipments;
  new_id uuid;
  suffix text := to_char(now(), 'MMDDHH24MI');
begin
  if not public.can_access_shipment(p_shipment) then raise exception 'No access'; end if;
  select * into src from public.shipments where id = p_shipment;
  if public.workspace_role(src.workspace_id) not in ('admin', 'member') then raise exception 'Internal member only'; end if;
  insert into public.shipments(
    workspace_id, reference_no, direction, partner_name, country, item_name, transport,
    document_lead_business_days, status, incoterm, note, owner_id, created_by
  ) values (
    src.workspace_id, left(src.reference_no || '-COPY-' || suffix, 120), src.direction, src.partner_name,
    src.country, src.item_name, src.transport, src.document_lead_business_days,
    'normal', src.incoterm, src.note, auth.uid(), auth.uid()
  ) returning id into new_id;
  return new_id;
end;
$$;

create or replace function public.protect_profile_email()
returns trigger language plpgsql as $$
begin
  new.email := old.email;
  return new;
end; $$;
create trigger protect_profile_email before update on public.profiles
for each row execute function public.protect_profile_email();

-- Immutable tenant identity guards. Prevent moving rows between workspaces/shipments through client updates.
create or replace function public.protect_shipment_identity()
returns trigger language plpgsql as $$
begin
  if new.workspace_id is distinct from old.workspace_id or new.created_by is distinct from old.created_by then
    raise exception 'Workspace identity cannot be changed';
  end if;
  if public.workspace_role(old.workspace_id) = 'external' then
    if new.reference_no is distinct from old.reference_no
       or new.direction is distinct from old.direction
       or new.partner_name is distinct from old.partner_name
       or new.country is distinct from old.country
       or new.item_name is distinct from old.item_name
       or new.transport is distinct from old.transport
       or new.document_lead_business_days is distinct from old.document_lead_business_days
       or new.incoterm is distinct from old.incoterm
       or new.owner_id is distinct from old.owner_id then
      raise exception 'External collaborators may only update schedule, status, and notes';
    end if;
  end if;
  return new;
end; $$;
create trigger protect_shipment_identity before update on public.shipments
for each row execute function public.protect_shipment_identity();

create or replace function public.protect_document_identity()
returns trigger language plpgsql as $$
begin
  if new.workspace_id is distinct from old.workspace_id or new.shipment_id is distinct from old.shipment_id then
    raise exception 'Document identity cannot be changed';
  end if;
  if public.workspace_role(old.workspace_id) = 'external' and new.doc_type is distinct from old.doc_type then
    raise exception 'External collaborators cannot rename document types';
  end if;
  if new.storage_path is distinct from old.storage_path then
    new.uploaded_by := auth.uid();
  end if;
  return new;
end; $$;
create trigger protect_document_identity before update on public.documents
for each row execute function public.protect_document_identity();

create or replace function public.protect_partner_identity()
returns trigger language plpgsql as $$
begin
  if new.workspace_id is distinct from old.workspace_id or new.created_by is distinct from old.created_by then
    raise exception 'Workspace identity cannot be changed';
  end if;
  return new;
end; $$;
create trigger protect_partner_identity before update on public.partners
for each row execute function public.protect_partner_identity();

-- Automatic timestamps and default documents
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

create trigger shipments_touch before update on public.shipments
for each row execute function public.touch_updated_at();
create trigger documents_touch before update on public.documents
for each row execute function public.touch_updated_at();
create trigger partners_touch before update on public.partners
for each row execute function public.touch_updated_at();

create or replace function public.create_default_documents()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.documents(workspace_id, shipment_id, doc_type)
  values
    (new.workspace_id, new.id, 'Commercial Invoice'),
    (new.workspace_id, new.id, 'Packing List'),
    (new.workspace_id, new.id, case when new.transport = 'air' then 'AWB' else 'B/L' end),
    (new.workspace_id, new.id, 'C/O'),
    (new.workspace_id, new.id, '검역/기타 증명서')
  on conflict do nothing;
  return new;
end;
$$;
create trigger shipment_default_docs after insert on public.shipments
for each row execute function public.create_default_documents();

create or replace function public.audit_trade_changes()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare wid uuid; sid uuid; act text; meta jsonb;
begin
  if tg_table_name = 'shipments' then
    wid := coalesce(new.workspace_id, old.workspace_id);
    sid := coalesce(new.id, old.id);
    act := case tg_op when 'INSERT' then 'shipment_created' when 'UPDATE' then 'shipment_updated' else 'shipment_deleted' end;
    meta := jsonb_build_object('reference_no', coalesce(new.reference_no, old.reference_no), 'status', coalesce(new.status::text, old.status::text));
  elsif tg_table_name = 'documents' then
    wid := coalesce(new.workspace_id, old.workspace_id);
    sid := coalesce(new.shipment_id, old.shipment_id);
    act := case tg_op when 'INSERT' then 'document_created' when 'UPDATE' then 'document_updated' else 'document_deleted' end;
    meta := jsonb_build_object('doc_type', coalesce(new.doc_type, old.doc_type), 'status', coalesce(new.status::text, old.status::text));
  else
    return coalesce(new, old);
  end if;
  insert into public.activities(workspace_id, shipment_id, actor_id, action, metadata)
  values(wid, sid, auth.uid(), act, meta);
  return coalesce(new, old);
end;
$$;

create trigger audit_shipments after insert or update or delete on public.shipments
for each row execute function public.audit_trade_changes();
create trigger audit_documents after insert or update or delete on public.documents
for each row execute function public.audit_trade_changes();

-- RLS
alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.workspace_invites enable row level security;
alter table public.shipments enable row level security;
alter table public.shipment_access enable row level security;
alter table public.documents enable row level security;
alter table public.comments enable row level security;
alter table public.activities enable row level security;
alter table public.partners enable row level security;

create policy profiles_select on public.profiles for select to authenticated
using (public.can_view_profile(id));
create policy profiles_update_self on public.profiles for update to authenticated
using (id = auth.uid()) with check (id = auth.uid());

create policy workspaces_select on public.workspaces for select to authenticated
using (public.is_workspace_member(id));
create policy workspaces_update_admin on public.workspaces for update to authenticated
using (public.workspace_role(id) = 'admin') with check (public.workspace_role(id) = 'admin');

create policy members_select on public.workspace_members for select to authenticated
using (user_id = auth.uid() or public.workspace_role(workspace_id) in ('admin','member'));
create policy invites_select on public.workspace_invites for select to authenticated
using (public.workspace_role(workspace_id) = 'admin');

create policy shipments_select on public.shipments for select to authenticated
using (public.can_access_shipment(id));
create policy shipments_insert on public.shipments for insert to authenticated
with check (public.workspace_role(workspace_id) in ('admin','member') and created_by = auth.uid());
create policy shipments_update on public.shipments for update to authenticated
using (public.can_access_shipment(id)) with check (public.can_access_shipment(id));
create policy shipments_delete on public.shipments for delete to authenticated
using (public.workspace_role(workspace_id) in ('admin','member'));

create policy access_select on public.shipment_access for select to authenticated
using (public.workspace_role(workspace_id) in ('admin','member') or user_id = auth.uid());
create policy access_insert_admin on public.shipment_access for insert to authenticated
with check (
  public.workspace_role(workspace_id) = 'admin'
  and created_by = auth.uid()
  and exists (select 1 from public.shipments s where s.id = shipment_id and s.workspace_id = workspace_id)
);
create policy access_delete_admin on public.shipment_access for delete to authenticated
using (public.workspace_role(workspace_id) = 'admin');

create policy documents_select on public.documents for select to authenticated
using (public.can_access_shipment(shipment_id));
create policy documents_insert on public.documents for insert to authenticated
with check (public.can_access_shipment(shipment_id));
create policy documents_update on public.documents for update to authenticated
using (public.can_access_shipment(shipment_id)) with check (public.can_access_shipment(shipment_id));
create policy documents_delete on public.documents for delete to authenticated
using (public.workspace_role(workspace_id) in ('admin','member') or uploaded_by = auth.uid());

create policy comments_select on public.comments for select to authenticated
using (public.can_access_shipment(shipment_id));
create policy comments_insert on public.comments for insert to authenticated
with check (public.can_access_shipment(shipment_id) and created_by = auth.uid());
create policy comments_update on public.comments for update to authenticated
using (created_by = auth.uid()) with check (created_by = auth.uid());
create policy comments_delete on public.comments for delete to authenticated
using (created_by = auth.uid() or public.workspace_role(workspace_id) = 'admin');

create policy activities_select on public.activities for select to authenticated
using (shipment_id is null and public.is_workspace_member(workspace_id) or shipment_id is not null and public.can_access_shipment(shipment_id));

create policy partners_select on public.partners for select to authenticated
using (public.workspace_role(workspace_id) in ('admin','member'));
create policy partners_insert on public.partners for insert to authenticated
with check (public.workspace_role(workspace_id) in ('admin','member') and created_by = auth.uid());
create policy partners_update on public.partners for update to authenticated
using (public.workspace_role(workspace_id) in ('admin','member')) with check (public.workspace_role(workspace_id) in ('admin','member'));
create policy partners_delete on public.partners for delete to authenticated
using (public.workspace_role(workspace_id) in ('admin','member'));

-- Private storage bucket. NEVER make this bucket public.
insert into storage.buckets (id, name, public, file_size_limit)
values ('trade-docs', 'trade-docs', false, 52428800)
on conflict (id) do update set public = false;

create policy trade_docs_select on storage.objects for select to authenticated
using (
  bucket_id = 'trade-docs'
  and public.can_access_shipment(((storage.foldername(name))[2])::uuid)
);
create policy trade_docs_insert on storage.objects for insert to authenticated
with check (
  bucket_id = 'trade-docs'
  and public.can_access_shipment(((storage.foldername(name))[2])::uuid)
);
create policy trade_docs_update on storage.objects for update to authenticated
using (
  bucket_id = 'trade-docs'
  and public.can_access_shipment(((storage.foldername(name))[2])::uuid)
);
create policy trade_docs_delete on storage.objects for delete to authenticated
using (
  bucket_id = 'trade-docs'
  and public.can_access_shipment(((storage.foldername(name))[2])::uuid)
);

-- Realtime: only tables useful for collaboration. RLS still applies.
alter publication supabase_realtime add table public.shipments;
alter publication supabase_realtime add table public.documents;
alter publication supabase_realtime add table public.comments;
