-- =====================================================================
-- 추가 기능: 판매실적에 "일별 부스 방문객 수" 입력 추가
-- migration_02_sales.sql 을 이미 실행한 DB 에서 이 파일을 한 번 실행하세요.
-- 여러 번 실행해도 안전합니다. 기존에 입력된 판매실적은 그대로 유지됩니다(방문객 수만 비어 있음).
-- =====================================================================

alter table public.bw_sales add column if not exists visitors integer;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'bw_sales_visitors_range') then
    alter table public.bw_sales add constraint bw_sales_visitors_range check (visitors is null or visitors between 0 and 1000000);
  end if;
end $$;

create or replace function public.bw_sales_json(r public.bw_sales) returns jsonb
language sql immutable set search_path = public as $$
  select jsonb_build_object(
    'companyId', r.company_id, 'day', to_char(r.day, 'YYYY-MM-DD'), 'items', r.items, 'amount', r.amount,
    'visitors', r.visitors,
    'surveyDone', r.survey_done, 'revision', r.revision,
    'firstSubmittedAt', r.first_submitted_at, 'updatedAt', r.updated_at);
$$;

-- 판매실적 저장 (없으면 새로 만들고, 있으면 수정). 10/25 은 만족도조사 완료가 필수입니다.
create or replace function public.bw_save_sales(payload jsonb) returns jsonb
language plpgsql volatile set search_path = public as $$
declare
  c public.bw_companies;
  old public.bw_sales;
  r public.bw_sales;
  v_day date := (payload->>'day')::date;
  v_items integer := (payload->>'items')::integer;
  v_amount bigint := (payload->>'amount')::bigint;
  v_visitors integer := (payload->>'visitors')::integer;
  v_survey boolean := coalesce((payload->>'surveyDone')::boolean, false);
  v_existed boolean;
begin
  select * into c from public.bw_companies where id = (payload->>'companyId')::uuid for update;
  if not found then raise exception 'BW_COMPANY_NOT_FOUND'; end if;
  if v_day not in ('2026-10-23', '2026-10-24', '2026-10-25') then raise exception 'BW_BAD_REQUEST'; end if;
  if v_items is null or v_amount is null or v_visitors is null or v_items < 0 or v_amount < 0 or v_visitors < 0 then raise exception 'BW_BAD_REQUEST'; end if;

  select * into old from public.bw_sales where company_id = c.id and day = v_day;
  v_existed := found;

  if v_day = '2026-10-25' and not (v_survey or (v_existed and old.survey_done)) then
    raise exception 'BW_SURVEY_REQUIRED';
  end if;

  insert into public.bw_sales (company_id, day, items, amount, visitors, survey_done)
  values (c.id, v_day, v_items, v_amount, v_visitors, v_day = '2026-10-25' and v_survey)
  on conflict (company_id, day) do update
    set items = excluded.items,
        amount = excluded.amount,
        visitors = excluded.visitors,
        survey_done = public.bw_sales.survey_done or excluded.survey_done,
        revision = public.bw_sales.revision + 1,
        updated_at = now()
  returning * into r;

  insert into public.bw_audit_logs (company_id, company_name, action, actor, detail)
  values (c.id, c.name, case when v_existed then 'sales_updated' else 'sales_created' end, 'company',
          jsonb_build_object('day', to_char(v_day, 'YYYY-MM-DD'), 'items', v_items, 'amount', v_amount, 'visitors', v_visitors, 'surveyDone', r.survey_done));

  return public.bw_sales_json(r);
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
