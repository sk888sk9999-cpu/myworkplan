# TradeFlow Secure — GitHub + Cloudflare Pages + Supabase

반복되는 무역 업무를 줄이기 위한 **무료 시작형 팀 협업 MVP**입니다. 특정 회사 전용이 아니라 누구나 워크스페이스를 만들어 팀원과 함께 사용할 수 있도록 설계했습니다.

## 들어있는 기능

- 관리자 승인·초대 사용자만 로그인 (공개 회원가입 없음)
- 회사·팀별 워크스페이스 데이터 분리
- 관리자 / 직원 / 외부 협력사 권한
- 외부 협력사는 **관리자가 따로 공유한 선적건만** 접근
- 수입 / 수출 업무 등록
- AIR / SEA, Cargo Ready, ETD, ETA, Incoterms
- 이전 업무 복사 → 반복 입력 감소
- ETD 기준 서류 신청 마감일 자동 계산(토/일 제외)
- Invoice / Packing List / B/L 또는 AWB / C/O / 검역·기타 서류 자동 체크리스트
- 비공개 파일 업로드
- 60초 만료 Signed URL로 문서 열기
- 댓글 / 업무 메모
- 변경 이력
- 거래처 저장
- 팀 초대 코드
- 기본 Realtime 갱신

## 왜 npm이 없나요?

이 버전은 무료 운영과 유지보수를 최대한 단순하게 하기 위해 **빌드 프레임워크가 없는 정적 웹**으로 만들었습니다.

- GitHub: 소스 저장
- Cloudflare Pages: 웹 배포
- Supabase: 로그인, DB, RLS, 비공개 파일

Cloudflare 배포 시 `build.sh`가 파일을 `dist/`에 복사하고 Supabase 공개 클라이언트 설정만 생성합니다. Node.js 패키지 설치가 필요 없습니다.

---

## 1) Supabase 설정

1. Supabase에서 새 프로젝트를 만듭니다.
2. **SQL Editor**를 엽니다.
3. `supabase/schema.sql` 내용을 전체 실행합니다.
4. Authentication > Sign In / Providers에서 **Allow new users to sign up을 OFF**로 설정합니다.
5. Email Provider는 활성화하고 Confirm email은 켜두는 것을 권장합니다.
6. 사용자는 Authentication > Users에서 관리자가 직접 초대합니다.
7. Project Settings/API에서 아래 값을 확인합니다.
   - Project URL
   - anon/publishable key

> `service_role` 키는 절대로 GitHub, config.js, Cloudflare 프론트엔드 환경변수에 넣지 마세요.

## 2) GitHub에 올리기

이 폴더 전체를 새 GitHub 저장소에 업로드합니다.

`config.js`와 `dist/`는 `.gitignore`에 포함되어 있습니다.

## 3) Cloudflare Pages 배포

Cloudflare Dashboard > Workers & Pages > Create > Pages > Connect to Git에서 GitHub 저장소를 연결합니다.

빌드 설정:

- Build command: `bash build.sh`
- Build output directory: `dist`

Cloudflare Pages의 Environment variables에 아래 두 값을 추가합니다.

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

배포가 끝나면 `https://xxxx.pages.dev` 주소가 생깁니다.

## 4) Supabase 로그인 URL 등록

Supabase > Authentication > URL Configuration에서:

- Site URL: Cloudflare Pages 주소
- Redirect URLs: Cloudflare Pages 주소

를 등록합니다.

## 5) 로컬에서 확인

```bash
SUPABASE_URL="https://YOUR_PROJECT.supabase.co" \
SUPABASE_ANON_KEY="YOUR_KEY" \
bash build.sh

python -m http.server 8080 -d dist
```

브라우저에서 `http://localhost:8080`을 엽니다.

---

## 보안 구조

보안은 화면에서 메뉴를 숨기는 것으로 끝나지 않습니다. DB에서 **RLS(Row Level Security)** 로 차단합니다.

- 모든 주요 업무 테이블 RLS 활성화
- 워크스페이스 멤버십 기반 데이터 분리
- 외부 협력사는 shipment-level allow list 사용
- 초대 코드는 외부 협력사에게 조회되지 않도록 별도 테이블에 저장
- 문서 Storage bucket은 `public=false`
- 문서 경로도 선적건 권한으로 RLS 검사
- 문서 열기는 60초 Signed URL
- 주요 변경 이력 기록
- tenant/workspace ID를 다른 회사로 이동시키는 업데이트 방지 트리거
- Cloudflare 보안 헤더 포함
- 브라우저에 `service_role` 미사용

## 운영 전에 꼭 할 보안 테스트

테스트 회사 A, 회사 B와 관리자/직원/외부 협력사 계정을 만들어 아래를 직접 확인하세요.

1. A회사 사용자가 B회사 shipment UUID를 알아도 조회되지 않는가
2. A회사 사용자가 B회사 문서 경로를 알아도 열리지 않는가
3. 외부 협력사가 공유받지 않은 업무를 조회하지 못하는가
4. 외부 협력사가 전체 팀 목록/거래처/초대 코드를 조회하지 못하는가
5. 일반 직원이 임의로 자신을 관리자로 변경하지 못하는가
6. 마지막 관리자 계정을 일반 직원으로 낮출 수 없는가

## 현재 마감일 계산 범위

현재 `서류 신청 리드타임`은 **토요일/일요일만 제외**합니다. 국가별 공휴일까지 반영하려면 다음 버전에서 국가별 Holiday Calendar를 추가하면 됩니다.

## 다음 단계로 넣기 좋은 기능

- 국가별 공휴일 포함 영업일 계산
- 오늘 할 일 자동 생성
- 담당자별 업무 보기
- 이메일 알림
- Invoice / Packing List 자동 읽기
- Invoice ↔ Packing List 불일치 검사
- Excel 내보내기
- 관리자 감사 로그 다운로드
