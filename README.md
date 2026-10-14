# BEAUTY WAVE in INCHEON 2026 · 참가업체 정보 취합 시스템

참가업체가 **업체별 전용 링크**로 대표 판매상품·행사 할인가·럭키드로우 경품 정보를 제출하면,
웰리더 운영사무국이 **관리자 페이지**에서 바로 확인·수정하고 **엑셀로 내려받는** 시스템입니다.

- 참가업체 화면: `https://<배포주소>/s/<업체별 토큰>` (로그인 없음, 자기 업체 정보만 작성·수정)
- 관리자 화면: `https://<배포주소>/admin` (비밀번호 로그인)

---

## 1. 구성

| 구분 | 사용 기술 | 역할 |
|---|---|---|
| 화면 | Next.js 15 (App Router) + React 19 | 참가업체 제출 페이지, 관리자 대시보드 |
| 서버 API | Next.js Route Handler (`/api/...`) | 입력값 검증, 인증, 엑셀 생성 |
| 데이터베이스 | Supabase (PostgreSQL) | 업체·제출·상품·경품·작업 이력 저장 |
| 배포 | Vercel (권장) | 웹사이트 호스팅 |

보안 구조
- 브라우저는 **우리 서버 API만** 호출합니다. Supabase 비밀키는 서버 환경변수에만 있고 화면 코드에 포함되지 않습니다.
- DB 테이블은 모두 **RLS(행 수준 보안)** 를 켜고 공개 정책을 만들지 않았습니다. 공개 키(anon)로는 아무 데이터도 읽거나 쓸 수 없습니다.
- DB 함수 실행 권한은 `service_role`(서버)에게만 있습니다.
- 참가업체는 추측할 수 없는 32자리 토큰 링크로만 접근하며, 그 토큰에 연결된 **자기 업체 정보만** 조회·저장됩니다.
- 관리자 세션은 서명된 HttpOnly 쿠키(12시간)로 관리합니다. 비밀번호를 바꾸면 기존 로그인은 모두 끊깁니다.
- 동시에 두 곳에서 저장하면 나중 저장이 덮어쓰지 않도록 **버전(revision) 충돌 검사**를 합니다.
- 제출·수정·삭제, 업체 등록·변경·삭제, 링크 재발급, 접수 마감은 모두 **작업 이력**에 남습니다(수정 전·후 내용 포함).

## 2. 폴더 구조

```
supabase/schema.sql          DB 테이블·보안·함수 (Supabase SQL Editor 에서 1회 실행)
src/app/                     페이지와 API 경로
  s/[token]/page.tsx         참가업체 제출 페이지
  admin/...                  관리자 페이지 (대시보드, 업체·링크, 럭키드로우, 엑셀, 이력)
  api/[...path]/route.ts     모든 API 진입점
src/middleware.ts            관리자 화면 로그인 확인
src/server/                  서버 전용 코드 (DB 호출, 인증, 엑셀)
src/components/              화면 컴포넌트
src/lib/                     계산(할인율·합계)·검증 규칙 (화면·서버 공용)
.env.example                 환경변수 예시
```

---

## 3. Supabase 준비 (약 10분)

1. https://supabase.com 에 가입 → **New project**
   - Region: **Northeast Asia (Seoul)** 권장
   - Database Password: 안전한 값으로 설정 후 따로 보관
2. 프로젝트가 만들어지면 왼쪽 메뉴 **SQL Editor** → **New query**
3. 이 프로젝트의 `supabase/schema.sql` 내용을 **전부 복사해 붙여넣고 Run**
   - "Success. No rows returned" 가 나오면 완료입니다. 여러 번 실행해도 기존 데이터는 유지됩니다.
4. **Project Settings → API (Data API)** 에서 다음 두 값을 확인합니다.
   - **Project URL** → `SUPABASE_URL`
   - **API Keys** 에서 `service_role` 키(legacy 탭) 또는 **Secret key**(`sb_secret_…`) → `SUPABASE_SERVICE_ROLE_KEY`
   - ⚠️ `anon`/`publishable` 키가 아니라 **service_role / secret** 키입니다. 이 키는 절대 공유하거나 화면 코드에 넣지 마세요.
5. **Table Editor** 에서 `bw_companies` 등 6개 테이블이 보이면 정상입니다.

## 4. 내 PC에서 실행해 보기

필요: Node.js 20 이상 (https://nodejs.org 에서 LTS 설치)

```bash
cd beauty-wave
npm install
copy .env.example .env.local        # macOS/Linux: cp .env.example .env.local
# .env.local 을 메모장으로 열어 값 4개를 채웁니다
npm run dev
```

- 관리자: http://localhost:3000/admin
- 처음 한 번은 `npm run build` 로 빌드 오류가 없는지 확인하세요.

`SESSION_SECRET` 만들기:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

## 5. 실제 운영 배포 (Vercel)

1. 이 폴더를 GitHub 비공개 저장소에 올립니다. (`.env.local` 은 `.gitignore` 로 제외되어 올라가지 않습니다)
2. https://vercel.com → **Add New → Project** → 저장소 선택 → Framework: **Next.js** (자동 인식)
3. **Environment Variables** 에 아래 값을 입력합니다. (Production / Preview 모두)

| 이름 | 값 | 비고 |
|---|---|---|
| `SUPABASE_URL` | `https://xxxx.supabase.co` | Supabase Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role 또는 secret 키 | 서버 전용, 절대 공개 금지 |
| `ADMIN_PASSWORD` | 10자 이상 | 관리자 로그인 비밀번호 |
| `SESSION_SECRET` | 32자 이상 임의 문자열 | 위 명령으로 생성 |
| `APP_BASE_URL` | `https://배포주소` | 선택. 링크 목록 엑셀에 쓰일 주소 |

4. **Deploy** → 완료되면 `https://<프로젝트명>.vercel.app/admin` 으로 접속해 로그인합니다.
5. (선택) Settings → Functions → Region 을 **Seoul (icn1)** 로 바꾸면 Supabase(서울)와 가까워져 더 빠릅니다.
6. (선택) 자체 도메인은 Settings → Domains 에서 연결합니다. 도메인을 바꾸면 `APP_BASE_URL` 도 함께 바꾸세요.

> 환경변수를 바꾼 뒤에는 Vercel 에서 **Redeploy** 해야 반영됩니다.

GitHub 없이 배포하려면 PC에서 `npx vercel` → 안내에 따라 로그인·배포 → Vercel 웹에서 환경변수 입력 → `npx vercel --prod`.

## 6. 관리자 계정과 보안 설정

- 관리자 계정은 **공용 비밀번호 1개** 방식입니다. 운영사무국 담당자끼리만 공유하세요.
- 비밀번호 규칙: 10자 이상, 영문 대소문자·숫자·기호를 섞어 사용. 행사명·연도처럼 추측 쉬운 값은 피하세요.
- 비밀번호 변경: Vercel 환경변수 `ADMIN_PASSWORD` 수정 → Redeploy. **기존 로그인은 모두 자동 로그아웃**됩니다.
- 담당자 퇴사·유출 의심 시: `ADMIN_PASSWORD` 와 `SESSION_SECRET` 를 모두 새 값으로 바꾸고 Redeploy.
- 로그인 실패가 15분 안에 10회를 넘으면 해당 IP 는 잠시 로그인이 막힙니다.
- Supabase 키 유출이 의심되면 Supabase 대시보드에서 키를 재발급(rotate)하고 Vercel 값을 교체하세요.
- 관리자·제출 페이지는 검색엔진에 노출되지 않도록 `noindex` 처리되어 있고, 링크가 다른 사이트로 새지 않도록 Referrer 를 보내지 않습니다.

## 7. 업체 등록과 링크 배포

1. 관리자 → **업체 · 링크 관리**
2. 업체 등록
   - **직접 입력**: 한 줄에 한 업체씩 붙여넣고 [업체 등록]
   - **엑셀 일괄 등록**: [등록 양식 내려받기] → A열에 업체명 입력 → [파일 선택해 등록] (.xlsx / .csv)
   - 이미 등록된 이름은 자동으로 건너뜁니다.
3. 링크 전달
   - 업체별 [복사] → 카카오톡·문자·메일로 전달
   - [전체 링크 복사] → `업체명 ⇥ 링크` 형식으로 복사되어 엑셀에 그대로 붙여넣을 수 있습니다
   - [링크 목록 엑셀] 로 업체명·링크·제출 여부를 한 번에 내려받을 수도 있습니다
4. 안내 문구 예시

```
[BEAUTY WAVE in INCHEON 2026] 참가업체 정보 제출 요청

안녕하세요, 운영사무국입니다.
가격 안내판 제작과 럭키드로우 운영을 위해 아래 귀사 전용 링크로
대표 판매상품·행사 할인가·럭키드로우 경품 정보를 제출해 주세요.

▶ 제출 링크: (업체별 링크)
▶ 제출 기한: ○월 ○일(○)까지
※ 이 링크는 귀사 전용입니다. 외부에 공유하지 말아 주세요.
※ 제출 후에도 같은 링크로 접속해 수정할 수 있습니다.
```

5. 운영 중 관리
   - **수정 잠금**: 업체별 토글. 켜면 그 업체는 내용을 볼 수만 있습니다(가격 안내판 인쇄 확정 후 사용).
   - **제출 접수 마감**: 대시보드의 [제출 접수] 토글을 끄면 모든 업체의 제출·수정이 막힙니다.
   - **링크 재발급**: 링크가 다른 곳에 퍼졌을 때 사용. 이전 링크는 즉시 무효가 되고 제출 정보는 유지됩니다.
   - **대신 입력하기**: 전화·메일로 받은 내용을 관리자가 직접 입력할 수 있습니다.

## 8. 엑셀 다운로드

| 파일 | 시트 | 용도 |
|---|---|---|
| 전체 참가업체 제출 정보 | 업체별 제출 현황 / 대표 판매상품 / 럭키드로우 경품 | 전체 취합본 (미제출 업체 포함) |
| 부스별 가격 안내판 제작용 | 가격 안내판 | 디자인·인쇄 업체 전달용 (상품 단위) |
| 럭키드로우 경품 관리 | 경품 목록 / 업체별 합계 | 경품 수령·관리 |
| 업체별 제출 링크 | 업체별 제출 링크 | 링크 일괄 안내 |

- 금액·수량은 **숫자 셀**에 `#,##0` 서식(천 단위 쉼표)으로 저장되어 바로 합계·정렬·필터가 됩니다.
- 할인율은 `0%` 서식의 숫자(예: 0.3 → 30%)입니다.
- 경품 총금액과 합계 행은 엑셀 수식(`=수량*단가`, `=SUM(...)`)으로 들어가 값을 고치면 다시 계산됩니다.
- 첫 행 고정·자동 필터가 적용되어 있습니다.

## 9. 입력 규칙 (화면과 서버에서 동일하게 검사)

- 대표 판매상품 1~3개, 상품명·정상가·할인가·샘플 여부·추가 혜택 필수 (혜택이 없으면 "없음")
- 할인가는 정상가 이하 (할인이 없으면 정상가와 같게 입력)
- 할인율 = (정상가 − 할인가) ÷ 정상가 × 100, **소수점 반올림 정수**
- 럭키드로우 "제공함" 선택 시 경품 1~10종, 상품명·수량(1개 이상)·1개 기준 정상가 필수
- 경품 총금액 = 수량 × 정상가, 전체 총수량·총금액 자동 집계

## 10. 백업과 행사 후 정리

- Supabase 무료 플랜은 자동 백업 보관 기간이 짧습니다. 마감 시점에 **전체 엑셀을 내려받아 보관**하세요.
- 행사 종료 후 링크를 막으려면 [제출 접수]를 끄거나, Vercel 프로젝트를 일시 중지(Pause)하세요.

## 11. 문제 해결

| 증상 | 확인할 것 |
|---|---|
| 로그인 시 "환경변수를 설정해 주세요" | `ADMIN_PASSWORD`(10자+), `SESSION_SECRET`(32자+) 입력 후 Redeploy |
| "데이터베이스 함수가 없습니다" | `supabase/schema.sql` 실행 여부. 실행했다면 SQL Editor 에서 `notify pgrst, 'reload schema';` 실행 |
| "데이터베이스 접근 권한이 없습니다" | `SUPABASE_SERVICE_ROLE_KEY` 에 anon 키를 넣지 않았는지 확인 |
| "서버 설정이 완료되지 않았습니다" | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` 누락 |
| 참가업체가 "유효하지 않은 링크" | 링크가 잘렸거나 재발급됨 → 관리자 화면에서 최신 링크 다시 복사 |
| "다른 곳에서 먼저 저장된 내용이 있습니다" | 다른 담당자(또는 관리자)가 먼저 저장함 → 새로고침 후 다시 저장 |

## 12. 개발 메모 — 검증한 범위

- `supabase/schema.sql` 은 PostgreSQL 16 에 Supabase 와 같은 역할(anon/authenticated/service_role)을 만들어 실행·재실행해 검증했습니다. anon 역할로는 테이블과 함수 모두 접근이 거부됩니다.
- 서버 API(`src/server/router.ts`)와 화면 컴포넌트는 같은 SQL 위에서 46개 API 시나리오와 브라우저 흐름으로 검증했습니다. 시나리오: 로그인, 업체 20곳 등록, 제출·재제출·충돌, 업체 간 격리, 잠금·마감, 엑셀 4종, 엑셀/CSV 일괄 등록, 링크 재발급, 삭제, 로그아웃, 위조 쿠키, 모바일 화면 폭.
- 작성 환경에서 npm 설치가 막혀 **Next.js 빌드(`npm run build`)는 직접 실행하지 못했습니다.** 배포 전에 PC에서 `npm install && npm run build` 를 한 번 실행해 주세요. Next.js 연결 파일(`src/app/**/page.tsx`, `route.ts`, `middleware.ts`)은 얇은 연결 코드만 담고 있습니다.
