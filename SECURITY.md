# TradeFlow Security Notes

이 프로젝트는 보안 우선 MVP입니다. 실제 영업비밀·단가·무역서류를 넣기 전에 조직의 보안정책과 법적 요구사항에 맞는 별도 검토가 필요합니다.

## 기본 방어

- Supabase Auth 사용
- 모든 주요 테이블 RLS
- workspace 단위 멀티테넌시
- external 역할은 shipment-level allow list
- 초대 코드 별도 보호 테이블
- private Storage
- signed URL 파일 조회
- 행의 workspace/shipment 정체성 변경 방지
- 활동 로그
- CSP, clickjacking 방어, nosniff, 권한 정책 헤더

## 절대로 하지 말 것

- RLS 끄기
- `trade-docs` 버킷을 Public으로 전환
- service_role 키를 브라우저에 넣기
- service_role 키를 GitHub에 커밋
- 실제 운영에서 이메일 확인을 꺼둔 채 불특정 사용자를 받기

## 권장 계정 보안

- Supabase 관리자 계정 MFA
- Cloudflare 계정 MFA
- GitHub 계정 2FA
- 실제 서비스 사용자 MFA는 서비스 규모가 커질 때 우선 도입
- 퇴사/계약종료 계정 즉시 멤버십 제거

## RLS 회귀 테스트

기능을 추가할 때마다 A/B 두 워크스페이스와 admin/member/external 계정으로 권한 테스트를 반복하세요. UI에서 안 보이는지보다 REST API를 직접 호출했을 때 DB가 거부하는지가 더 중요합니다.
