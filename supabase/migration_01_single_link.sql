-- =====================================================================
-- 추가 기능: 단일 링크 접속 (업체명 선택 + 담당자 휴대폰 뒷자리 4자리 확인)
-- schema.sql 을 이미 실행한 DB 에 이 파일을 한 번 실행하세요. 여러 번 실행해도 안전합니다.
-- =====================================================================

alter table public.bw_companies add column if not exists verify_code text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'bw_companies_verify_code_chk') then
    alter table public.bw_companies add constraint bw_companies_verify_code_chk check (verify_code is null or verify_code ~ '^[0-9]{4}$');
  end if;
end $$;

-- 확인번호 오입력 기록 (5회 틀리면 10분 잠금)
create table if not exists public.bw_entry_attempts (
  company_id uuid primary key references public.bw_companies(id) on delete cascade,
  failed integer not null default 0,
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.bw_entry_attempts enable row level security;
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on public.bw_entry_attempts from %I', r);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant all on public.bw_entry_attempts to service_role;
  end if;
end $$;

-- 접속 화면용 업체 목록 (이름만)
create or replace function public.bw_entry_companies(payload jsonb default '{}'::jsonb) returns jsonb
language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name) order by sort_order, created_at), '[]'::jsonb)
  from public.bw_companies;
$$;

-- 확인번호 검증 → 맞으면 해당 업체 입력 화면 주소(토큰) 반환
create or replace function public.bw_verify_entry(payload jsonb) returns jsonb
language plpgsql volatile set search_path = public as $$
declare
  c public.bw_companies;
  a public.bw_entry_attempts;
  v_code text := coalesce(payload->>'code', '');
begin
  select * into c from public.bw_companies where id = (payload->>'companyId')::uuid;
  if not found then raise exception 'BW_COMPANY_NOT_FOUND'; end if;
  if c.verify_code is null then return jsonb_build_object('status', 'no_code'); end if;

  select * into a from public.bw_entry_attempts where company_id = c.id for update;
  if found and a.locked_until is not null and a.locked_until > now() then
    return jsonb_build_object('status', 'locked', 'until', a.locked_until);
  end if;

  if v_code = c.verify_code then
    delete from public.bw_entry_attempts where company_id = c.id;
    return jsonb_build_object('status', 'ok', 'token', c.access_token);
  end if;

  insert into public.bw_entry_attempts (company_id, failed, locked_until, updated_at)
  values (c.id, 1, null, now())
  on conflict (company_id) do update
    set failed = public.bw_entry_attempts.failed + 1, locked_until = null, updated_at = now()
  returning * into a;

  if a.failed >= 5 then
    update public.bw_entry_attempts set failed = 0, locked_until = now() + interval '10 minutes' where company_id = c.id;
    return jsonb_build_object('status', 'locked', 'until', now() + interval '10 minutes');
  end if;
  return jsonb_build_object('status', 'wrong', 'remaining', 5 - a.failed);
end $$;

-- 관리자 화면에 확인번호 표시
create or replace function public.bw_admin_overview(payload jsonb default '{}'::jsonb) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object(
    'settings', (select jsonb_build_object('submissionOpen', submission_open, 'updatedAt', updated_at) from public.bw_settings where id = 1),
    'companies', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'token', c.access_token, 'sortOrder', c.sort_order,
        'isLocked', c.is_locked, 'createdAt', c.created_at, 'verifyCode', c.verify_code,
        'submission', public.bw_submission_json(c.id)) order by c.sort_order, c.created_at)
      from public.bw_companies c), '[]'::jsonb));
$$;

-- 업체 정보 변경: 확인번호(verifyCode) 도 변경 가능
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
  if payload ? 'verifyCode' then
    if (payload->>'verifyCode') is distinct from v_company.verify_code then
      v_changes := v_changes || jsonb_build_object('verifyCode', 'changed');
    end if;
    update public.bw_companies set verify_code = nullif(payload->>'verifyCode', ''), updated_at = now() where id = v_company.id;
    delete from public.bw_entry_attempts where company_id = v_company.id;
  end if;
  if v_changes <> '{}'::jsonb then
    insert into public.bw_audit_logs (company_id, company_name, action, actor, detail)
    values (v_company.id, coalesce(btrim(payload->>'name'), v_company.name), 'company_updated', 'admin', v_changes);
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- 함수 실행 권한: service_role(서버) 전용
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'bw\_%'
  loop
    execute format('revoke all on function %s from public', f.sig);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on function %s from anon', f.sig); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('revoke all on function %s from authenticated', f.sig); end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant execute on function %s to service_role', f.sig); end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
