-- =====================================================================
-- BEAUTY WAVE in INCHEON 2026 · 참가업체 정보 취합 시스템
-- Supabase SQL Editor 에 전체를 붙여넣고 한 번 실행하세요.
-- 여러 번 실행해도 안전하도록 작성되어 있습니다(기존 데이터 유지).
-- =====================================================================

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- 1. 테이블
-- ---------------------------------------------------------------------

-- 전역 설정 (행 1개만 존재)
create table if not exists public.bw_settings (
  id smallint primary key default 1 check (id = 1),
  submission_open boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into public.bw_settings (id) values (1) on conflict (id) do nothing;

-- 참가업체 명단 (관리자가 사전 등록)
create table if not exists public.bw_companies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 100),
  access_token text not null unique check (char_length(access_token) >= 32),
  sort_order integer not null default 0,
  is_locked boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists bw_companies_name_key on public.bw_companies (lower(btrim(name)));

-- 업체별 제출 정보 (업체당 1건 → 중복 제출 불가, 재제출 시 갱신)
create table if not exists public.bw_submissions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null unique references public.bw_companies(id) on delete cascade,
  company_name text not null check (char_length(btrim(company_name)) between 1 and 100),
  lucky_draw_provided boolean not null,
  revision integer not null default 1,
  first_submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text not null check (updated_by in ('company', 'admin'))
);

-- 대표 판매상품 (최대 3개)
create table if not exists public.bw_products (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.bw_submissions(id) on delete cascade,
  position smallint not null check (position between 1 and 3),
  name text not null check (char_length(btrim(name)) between 1 and 100),
  regular_price integer not null check (regular_price between 1 and 100000000),
  event_price integer not null check (event_price >= 0 and event_price <= regular_price),
  sample_provided boolean not null,
  extra_benefit text not null default '' check (char_length(extra_benefit) <= 300),
  unique (submission_id, position)
);

-- 럭키드로우 경품 (최대 10종)
create table if not exists public.bw_gifts (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.bw_submissions(id) on delete cascade,
  position smallint not null check (position between 1 and 10),
  name text not null check (char_length(btrim(name)) between 1 and 100),
  quantity integer not null check (quantity between 1 and 100000),
  unit_price integer not null check (unit_price between 0 and 100000000),
  unique (submission_id, position)
);

-- 작업 이력 (제출·수정·삭제·업체 관리)
create table if not exists public.bw_audit_logs (
  id bigint generated always as identity primary key,
  company_id uuid references public.bw_companies(id) on delete set null,
  company_name text,
  action text not null,
  actor text not null check (actor in ('company', 'admin')),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists bw_audit_logs_created_idx on public.bw_audit_logs (created_at desc);

-- ---------------------------------------------------------------------
-- 2. 접근 차단: RLS 켜고 정책을 만들지 않음 → anon/authenticated 키로는
--    어떤 행도 읽거나 쓸 수 없습니다. 서버(service_role)만 접근합니다.
-- ---------------------------------------------------------------------
alter table public.bw_settings   enable row level security;
alter table public.bw_companies  enable row level security;
alter table public.bw_submissions enable row level security;
alter table public.bw_products   enable row level security;
alter table public.bw_gifts      enable row level security;
alter table public.bw_audit_logs enable row level security;

do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on public.bw_settings, public.bw_companies, public.bw_submissions, public.bw_products, public.bw_gifts, public.bw_audit_logs from %I', r);
    end if;
  end loop;
  -- 서버 전용 역할(service_role)은 RLS 를 우회하며 테이블 전체 권한을 가집니다.
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant usage on schema public to service_role;
    grant usage on schema extensions to service_role;
    grant all on public.bw_settings, public.bw_companies, public.bw_submissions, public.bw_products, public.bw_gifts, public.bw_audit_logs to service_role;
    grant usage, select on all sequences in schema public to service_role;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 3. 함수 (서버에서 RPC 로만 호출)
-- ---------------------------------------------------------------------

create or replace function public.bw_new_token() returns text
language sql volatile set search_path = public, extensions as $$
  select translate(encode(gen_random_bytes(24), 'base64'), '+/', '-_');
$$;

create or replace function public.bw_submission_json(p_company_id uuid) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object(
    'id', s.id,
    'companyName', s.company_name,
    'luckyDrawProvided', s.lucky_draw_provided,
    'revision', s.revision,
    'firstSubmittedAt', s.first_submitted_at,
    'updatedAt', s.updated_at,
    'updatedBy', s.updated_by,
    'products', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', p.name, 'regularPrice', p.regular_price, 'eventPrice', p.event_price,
        'sampleProvided', p.sample_provided, 'extraBenefit', p.extra_benefit) order by p.position)
      from public.bw_products p where p.submission_id = s.id), '[]'::jsonb),
    'gifts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', g.name, 'quantity', g.quantity, 'unitPrice', g.unit_price) order by g.position)
      from public.bw_gifts g where g.submission_id = s.id), '[]'::jsonb)
  )
  from public.bw_submissions s where s.company_id = p_company_id;
$$;

-- 참가업체 링크(토큰)로 자기 업체 정보 조회
create or replace function public.bw_get_by_token(payload jsonb) returns jsonb
language plpgsql stable set search_path = public as $$
declare
  c public.bw_companies;
  v_open boolean;
begin
  select * into c from public.bw_companies where access_token = payload->>'token';
  if not found then return null; end if;
  select submission_open into v_open from public.bw_settings where id = 1;
  return jsonb_build_object(
    'company', jsonb_build_object('id', c.id, 'name', c.name, 'isLocked', c.is_locked),
    'submissionOpen', coalesce(v_open, true),
    'submission', public.bw_submission_json(c.id));
end $$;

-- 제출 저장 (신규 생성 또는 기존 건 갱신). 업체 행을 잠가 동시 제출을 직렬화합니다.
create or replace function public.bw_save_submission(payload jsonb) returns jsonb
language plpgsql volatile set search_path = public as $$
declare
  v_actor text := payload->>'actor';
  v_expected integer := nullif(payload->>'expectedRevision', '')::integer;
  v_data jsonb := payload->'data';
  v_company public.bw_companies;
  v_sub public.bw_submissions;
  v_open boolean;
  v_sub_id uuid;
  v_before jsonb;
  v_after jsonb;
  v_action text;
  v_lucky boolean;
  v_products jsonb;
  v_gifts jsonb;
begin
  if v_actor is null or v_actor not in ('company', 'admin') then raise exception 'BW_BAD_REQUEST'; end if;
  if v_data is null or jsonb_typeof(v_data) <> 'object' then raise exception 'BW_BAD_REQUEST'; end if;

  v_lucky := (v_data->>'luckyDrawProvided')::boolean;
  v_products := coalesce(v_data->'products', '[]'::jsonb);
  v_gifts := case when v_lucky then coalesce(v_data->'gifts', '[]'::jsonb) else '[]'::jsonb end;
  if v_lucky is null then raise exception 'BW_BAD_REQUEST'; end if;
  if jsonb_typeof(v_products) <> 'array' or jsonb_array_length(v_products) not between 1 and 3 then raise exception 'BW_BAD_REQUEST'; end if;
  if jsonb_typeof(v_gifts) <> 'array' or jsonb_array_length(v_gifts) > 10 then raise exception 'BW_BAD_REQUEST'; end if;
  if v_lucky and jsonb_array_length(v_gifts) = 0 then raise exception 'BW_BAD_REQUEST'; end if;

  select * into v_company from public.bw_companies where id = (payload->>'companyId')::uuid for update;
  if not found then raise exception 'BW_COMPANY_NOT_FOUND'; end if;

  if v_actor = 'company' then
    select submission_open into v_open from public.bw_settings where id = 1;
    if not coalesce(v_open, true) then raise exception 'BW_CLOSED'; end if;
    if v_company.is_locked then raise exception 'BW_LOCKED'; end if;
  end if;

  select * into v_sub from public.bw_submissions where company_id = v_company.id for update;
  if found then
    if v_expected is distinct from v_sub.revision then raise exception 'BW_CONFLICT'; end if;
    v_before := public.bw_submission_json(v_company.id);
    update public.bw_submissions
       set company_name = btrim(v_data->>'companyName'),
           lucky_draw_provided = v_lucky,
           revision = revision + 1,
           updated_at = now(),
           updated_by = v_actor
     where id = v_sub.id;
    v_sub_id := v_sub.id;
    delete from public.bw_products where submission_id = v_sub_id;
    delete from public.bw_gifts where submission_id = v_sub_id;
    v_action := 'submission_updated';
  else
    if v_expected is not null then raise exception 'BW_CONFLICT'; end if;
    insert into public.bw_submissions (company_id, company_name, lucky_draw_provided, updated_by)
    values (v_company.id, btrim(v_data->>'companyName'), v_lucky, v_actor)
    returning id into v_sub_id;
    v_action := 'submission_created';
  end if;

  insert into public.bw_products (submission_id, position, name, regular_price, event_price, sample_provided, extra_benefit)
  select v_sub_id, t.ord, btrim(t.e->>'name'), (t.e->>'regularPrice')::integer, (t.e->>'eventPrice')::integer,
         (t.e->>'sampleProvided')::boolean, coalesce(btrim(t.e->>'extraBenefit'), '')
  from jsonb_array_elements(v_products) with ordinality as t(e, ord);

  insert into public.bw_gifts (submission_id, position, name, quantity, unit_price)
  select v_sub_id, t.ord, btrim(t.e->>'name'), (t.e->>'quantity')::integer, (t.e->>'unitPrice')::integer
  from jsonb_array_elements(v_gifts) with ordinality as t(e, ord);

  v_after := public.bw_submission_json(v_company.id);
  insert into public.bw_audit_logs (company_id, company_name, action, actor, detail)
  values (v_company.id, v_company.name, v_action, v_actor, jsonb_build_object('before', v_before, 'after', v_after));

  return v_after;
end $$;

create or replace function public.bw_delete_submission(payload jsonb) returns jsonb
language plpgsql volatile set search_path = public as $$
declare
  v_company public.bw_companies;
  v_before jsonb;
begin
  select * into v_company from public.bw_companies where id = (payload->>'companyId')::uuid for update;
  if not found then raise exception 'BW_COMPANY_NOT_FOUND'; end if;
  v_before := public.bw_submission_json(v_company.id);
  if v_before is null then raise exception 'BW_NOT_SUBMITTED'; end if;
  delete from public.bw_submissions where company_id = v_company.id;
  insert into public.bw_audit_logs (company_id, company_name, action, actor, detail)
  values (v_company.id, v_company.name, 'submission_deleted', 'admin', jsonb_build_object('before', v_before));
  return jsonb_build_object('ok', true);
end $$;

-- 관리자 화면 전체 데이터
create or replace function public.bw_admin_overview(payload jsonb default '{}'::jsonb) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object(
    'settings', (select jsonb_build_object('submissionOpen', submission_open, 'updatedAt', updated_at) from public.bw_settings where id = 1),
    'companies', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'token', c.access_token, 'sortOrder', c.sort_order,
        'isLocked', c.is_locked, 'createdAt', c.created_at,
        'submission', public.bw_submission_json(c.id)) order by c.sort_order, c.created_at)
      from public.bw_companies c), '[]'::jsonb));
$$;

-- 업체 일괄 등록 (이미 있는 이름은 건너뜀)
create or replace function public.bw_add_companies(payload jsonb) returns jsonb
language plpgsql volatile set search_path = public as $$
declare
  v_name text;
  v_added jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  v_order integer;
  v_id uuid;
begin
  if jsonb_typeof(payload->'names') <> 'array' or jsonb_array_length(payload->'names') > 200 then
    raise exception 'BW_BAD_REQUEST';
  end if;
  select coalesce(max(sort_order), 0) into v_order from public.bw_companies;
  for v_name in select btrim(value) from jsonb_array_elements_text(payload->'names') loop
    if v_name = '' or char_length(v_name) > 100 then
      continue;
    end if;
    if exists (select 1 from public.bw_companies where lower(btrim(name)) = lower(v_name)) then
      v_skipped := v_skipped || to_jsonb(v_name);
      continue;
    end if;
    v_order := v_order + 1;
    insert into public.bw_companies (name, access_token, sort_order)
    values (v_name, public.bw_new_token(), v_order) returning id into v_id;
    insert into public.bw_audit_logs (company_id, company_name, action, actor) values (v_id, v_name, 'company_created', 'admin');
    v_added := v_added || to_jsonb(v_name);
  end loop;
  return jsonb_build_object('added', v_added, 'skipped', v_skipped);
end $$;

create or replace function public.bw_update_company(payload jsonb) returns jsonb
language plpgsql volatile set search_path = public as $$
declare
  v_company public.bw_companies;
  v_changes jsonb := '{}'::jsonb;
begin
  select * into v_company from public.bw_companies where id = (payload->>'companyId')::uuid for update;
  if not found then raise exception 'BW_COMPANY_NOT_FOUND'; end if;
  if payload ? 'name' then
    if btrim(payload->>'name') <> v_company.name then
      v_changes := v_changes || jsonb_build_object('name', jsonb_build_object('from', v_company.name, 'to', btrim(payload->>'name')));
    end if;
    update public.bw_companies set name = btrim(payload->>'name'), updated_at = now() where id = v_company.id;
  end if;
  if payload ? 'isLocked' then
    if (payload->>'isLocked')::boolean <> v_company.is_locked then
      v_changes := v_changes || jsonb_build_object('isLocked', (payload->>'isLocked')::boolean);
    end if;
    update public.bw_companies set is_locked = (payload->>'isLocked')::boolean, updated_at = now() where id = v_company.id;
  end if;
  if v_changes <> '{}'::jsonb then
    insert into public.bw_audit_logs (company_id, company_name, action, actor, detail)
    values (v_company.id, coalesce(btrim(payload->>'name'), v_company.name), 'company_updated', 'admin', v_changes);
  end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.bw_regenerate_token(payload jsonb) returns jsonb
language plpgsql volatile set search_path = public as $$
declare
  v_company public.bw_companies;
  v_token text := public.bw_new_token();
begin
  update public.bw_companies set access_token = v_token, updated_at = now()
   where id = (payload->>'companyId')::uuid returning * into v_company;
  if not found then raise exception 'BW_COMPANY_NOT_FOUND'; end if;
  insert into public.bw_audit_logs (company_id, company_name, action, actor) values (v_company.id, v_company.name, 'token_regenerated', 'admin');
  return jsonb_build_object('token', v_token);
end $$;

create or replace function public.bw_delete_company(payload jsonb) returns jsonb
language plpgsql volatile set search_path = public as $$
declare
  v_company public.bw_companies;
begin
  select * into v_company from public.bw_companies where id = (payload->>'companyId')::uuid for update;
  if not found then raise exception 'BW_COMPANY_NOT_FOUND'; end if;
  insert into public.bw_audit_logs (company_id, company_name, action, actor, detail)
  values (v_company.id, v_company.name, 'company_deleted', 'admin',
          jsonb_build_object('before', public.bw_submission_json(v_company.id)));
  delete from public.bw_companies where id = v_company.id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.bw_set_settings(payload jsonb) returns jsonb
language plpgsql volatile set search_path = public as $$
begin
  if not (payload ? 'submissionOpen') then raise exception 'BW_BAD_REQUEST'; end if;
  update public.bw_settings set submission_open = (payload->>'submissionOpen')::boolean, updated_at = now() where id = 1;
  insert into public.bw_audit_logs (action, actor, detail)
  values ('settings_updated', 'admin', jsonb_build_object('submissionOpen', (payload->>'submissionOpen')::boolean));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.bw_list_logs(payload jsonb default '{}'::jsonb) returns jsonb
language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', l.id, 'companyId', l.company_id, 'companyName', l.company_name, 'action', l.action,
      'actor', l.actor, 'detail', l.detail, 'createdAt', l.created_at) order by l.id desc), '[]'::jsonb)
  from (
    select * from public.bw_audit_logs
    order by id desc
    limit least(greatest(coalesce((payload->>'limit')::integer, 300), 1), 1000)
  ) l;
$$;

-- ---------------------------------------------------------------------
-- 4. 함수 실행 권한: service_role(서버) 전용
-- ---------------------------------------------------------------------
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'bw\_%'
  loop
    execute format('revoke all on function %s from public', f.sig);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon', f.sig);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke all on function %s from authenticated', f.sig);
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', f.sig);
    end if;
  end loop;
end $$;

-- Supabase API 가 새 함수를 바로 인식하도록 스키마 캐시 새로고침
notify pgrst, 'reload schema';
