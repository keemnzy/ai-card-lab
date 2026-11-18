# Meetcha 서버 (백엔드 MVP)

NFC 키링 태그 → 프로필 → 도감 → 퀴즈 → 메모·메시지, 그리고 이벤트 모드까지 동작하는 API 서버.

- Node 22.13 이상, Express, SQLite(Node 내장 `node:sqlite`)만 사용. DB 서버 설치가 필요 없다.
- 프론트엔드는 아직 연결 전. 지금은 태그 후 보이는 간단한 프로필 페이지(`/u/:id`)만 서버가 직접 그린다.

## 실행

```bash
cd meetcha/server
npm install
npm test          # 테스트 25개
npm run seed      # 예시 참가자 3명 + 키링 + 진행 중 이벤트 생성, 키링 URL 출력
npm run dev       # http://localhost:3000
```

`npm run seed`가 출력한 키링 URL을 브라우저에서 열면 그 사람 키링을 태그한 것과 같다.
로그인 링크는 개발 중에는 메일 대신 **서버 터미널에 출력**된다.

## 환경 변수

| 이름 | 설명 | 기본값 |
|---|---|---|
| `APP_ORIGIN` | 서비스 주소. 운영에서는 반드시 `https://` | `http://localhost:3000` |
| `PORT` | 포트 | `3000` |
| `DB_PATH` | SQLite 파일 경로 | `meetcha.db` |
| `ADMIN_EMAILS` | 운영진 이메일(쉼표 구분). 키링 발급·이벤트 생성 가능 | 없음 |
| `SUN_META_KEY` | NTAG 424 DNA 공통 읽기 키 (32자리 hex) | 없음 |
| `SUN_MASTER_KEY` | 칩별 파일 키를 만드는 마스터 키 (32자리 hex) | 없음 |
| `TRUST_PROXY` | 앞단 프록시 수 (IP 기반 레이트 리밋용) | 없음 |

칩 키는 **저장소에 절대 넣지 말 것.** 운영 서버의 비밀 저장소(환경 변수)에만 둔다.

## API 요약

모든 POST는 `Content-Type: application/json`이어야 한다. 로그인은 HttpOnly 쿠키 세션.

| 메서드 | 경로 | 설명 |
|---|---|---|
| POST | `/api/auth/request` | `{email}` 로그인 링크 메일 발송 |
| POST | `/api/auth/verify` | `{token, consent?}` 로그인. 처음 가입이면 `consent: {age, terms, privacy}` 모두 true 필요. 로그인 전에 태그한 키링이 있으면 도감에 추가 |
| POST | `/api/auth/logout` | 로그아웃 |
| GET | `/api/me` | 내 프로필·링크·퀴즈(정답 포함)·키링 |
| PUT | `/api/me/profile` | `{name, role, org, oneLiner, hint, visibility}` |
| PUT | `/api/me/links` | `{links:[{label,url}]}` 최대 8개, https만 |
| PUT | `/api/me/quiz` | `{quiz:[{question, options[4], answer}]}` 최대 5문제 |
| POST | `/api/me/consent` | `{age, terms, privacy}` 약관이 바뀐 뒤 다시 동의 (`/api/me`의 `consentRequired`) |
| POST | `/api/me/tags/claim` | `{claimCode}` 포장에 인쇄된 코드로 내 키링 등록 |
| POST | `/api/me/tags/:id/lost` | 분실 신고 (즉시 비활성화) |
| DELETE | `/api/me` | 탈퇴 |
| GET | `/t?e=&c=` | NTAG 424 DNA 태그 (서명·카운터 검증) |
| GET | `/t/:code` | 고정 링크 키링 태그 (NTAG215 등) |
| GET | `/u/:id` | 태그 후 보이는 프로필 페이지 (HTML) |
| GET | `/api/users/:id` | 프로필 (공개 범위 적용, 정답 미포함) |
| GET | `/api/dex` | 내 도감 (`?groupBy=event` 행사별로 묶기) |
| GET | `/api/dex/vcard` | 도감을 연락처 파일(.vcf)로 (`?eventId=` 행사별) |
| GET | `/api/users/:id/vcard` | 한 사람을 연락처 파일로 |
| PUT | `/api/users/:id/note` | 나만 보는 메모 |
| POST | `/api/users/:id/messages` | 메시지 (만난 사이만) |
| GET | `/api/me/messages` | 받은 메시지 |
| POST | `/api/users/:id/block` | 차단 |
| POST | `/api/users/:id/report` | `{reason, detail}` 신고 (만난 사람이나 전체 공개 명함만) |
| POST | `/api/users/:id/quiz/attempts` | 퀴즈 시작 (도감에 있는 사람만) |
| POST | `/api/quiz/attempts/:aid/answer` | `{choice: 0~3, -1=시간 초과}` 서버가 채점·점수 계산 |
| POST | `/api/events/checkin` | `{code, showOnLeaderboard}` 행사 체크인 |
| GET | `/api/events/:id/board` | 발견 보드 (못 만난 사람은 힌트만) |
| GET | `/api/events/:id/leaderboard` | 리더보드 (동의한 사람만) |
| GET | `/api/events/:id/stream` | 실시간 피드 (SSE, 아래 참고) |
| GET | `/api/events/:id/recap` | 행사 리캡: 만난 사람, 나를 만난 사람 수, 순위, 안 푼 퀴즈 |
| PUT | `/api/events/:id/leaderboard-consent` | `{show}` 리더보드 동의 바꾸기 |
| GET | `/claim` | 행사용 키링 첫 태그 후 등록 확인 페이지 (HTML) |
| POST | `/api/me/tags/claim-tap` | 방금 태그한 행사용 키링을 내 것으로 등록 + 체크인 |
| POST | `/api/admin/tags` | 키링 발급 `{kind:"static", count}` 또는 `{kind:"sun", uids:[...]}`. `eventId`를 주면 행사용 키링 |
| POST | `/api/admin/events/:id/attendees/import` | 참가자 명단 `{csv}` 또는 `{attendees:[...]}` |
| GET | `/api/admin/events/:id/attendees` | 명단, 가입·체크인 현황 |
| POST | `/api/admin/events/:id/invites/send` | 행사 전 "카드 미리 만들기" 메일 (안 보낸 사람만) |
| PUT | `/api/admin/events/:id/theme` | `{logoUrl, color, welcome}` |
| POST | `/api/admin/events/:id/desk` | `{on}` 이 기기를 체크인 데스크로 |
| POST | `/api/admin/events/:id/recap/send` | 행사 끝난 뒤 리캡 메일 (한 번만) |
| POST | `/api/admin/events` | 이벤트 생성 → 체크인 코드 |
| GET | `/api/admin/events/:id/report` | 고객사용 리포트 (통계만) |
| GET | `/api/admin/reports?status=open` | 신고 목록 (신고가 많이 쌓인 사람 먼저) |
| POST | `/api/admin/reports/:id/resolve` | `{status: "actioned"\|"dismissed", note}` |
| POST | `/api/admin/users/:id/suspend` | `{days?, reason}` 이용 정지 (days 없으면 영구), 로그인 즉시 끊김 |
| POST | `/api/admin/users/:id/unsuspend` | 정지 해제 |
| GET | `/legal/terms`, `/legal/privacy` | 약관·처리방침 원문 (`?lang=en` 영문) |

## 행사 운영 흐름

```
행사 전   주최사 명단 CSV 업로드 ─→ "카드 미리 만들기" 메일 ─→ 참가자가 링크로 가입 (이름·직함·소속 미리 채워짐)
          운영진이 행사용 키링 발급 (eventId)  ─→ 3D 프린팅 키링에 칩 링크 기록
행사장    처음 받은 키링: 참가자가 자기 휴대폰으로 태그 → 로그인 → "내 키링으로 등록하고 체크인" 한 번
          이미 키링이 있는 사람: 운영진 휴대폰(데스크 모드)에 태그 → 체크인
          서로 키링 태그 → 발견 보드, 실시간 피드
행사 후   리캡 메일 → 리캡 페이지(만난 사람, 퀴즈 다시 풀기) → 연락처 저장
```

CSV는 첫 줄에 열 이름이 있어야 하고 `email`은 필수. `name` 또는 `First Name`+`Last Name`, `Company`/`Organization`, `Job Title`/`Title` 등 흔한 열 이름(Luma, Eventbrite 내보내기 포함)을 알아서 맞춘다.

## 이벤트 실시간 피드

브라우저에서 `new EventSource("/api/events/<id>/stream")`으로 연결한다. 체크인한 참가자만 연결할 수 있고, 한 사람당 창 3개까지.

| 이벤트 | 받는 사람 | 내용 |
|---|---|---|
| `ready` | 연결한 본인 | 체크인 수, 만남 수, 리더보드 (연결 직후 한 번) |
| `checkin` | 참가자 전원 (본인 제외) | 체크인 수만. 이름 없음 → 보드를 다시 불러와 가려진 카드 추가 |
| `found` | 태그한 본인 | 새로 발견한 사람의 이름·직함·소속 |
| `tagged` | 태그당한 사람 | 나를 태그한 사람 이름 |
| `activity` | 참가자 전원 | 누가 몇 명째 만났는지. 리더보드 비동의자는 `who: null` |
| `stats` | 참가자 전원 | 체크인 수, 만남 수 |
| `leaderboard` | 참가자 전원 | 리더보드 (동의자만) |

행사 전에 이미 만난 사이를 다시 태그하면 알림을 보내지 않는다. 구독은 서버 메모리에 있으므로, 서버를 여러 대로 늘리면 Redis pub/sub 등으로 바꿔야 한다(`src/realtime.js`의 `createBus`).

## 보안에서 구현된 것

- **NTAG 424 DNA SUN 검증**: AES-CMAC 서명 확인 + 읽기 카운터 증가 확인. NXP 공식 예제(AN12196)로 테스트함. 복사된 링크는 프로필만 보이고 도감에는 안 들어간다.
- **고정 링크 키링**: 링크 코드와 등록 코드 모두 서버에는 해시만 저장. 도감에 `verified: false`로 표시.
- **퀴즈**: 정답은 서버에만. 문제 발급 시각 기준으로 서버가 속도 점수 계산 (10초 + 네트워크 여유 1.5초).
- **로그인**: 15분짜리 1회용 매직 링크. 메일 보안 스캐너가 링크를 미리 열어도 로그인되지 않도록 버튼을 눌러야 로그인. 가입 여부를 응답으로 알려 주지 않음.
- **세션**: HttpOnly, SameSite=Lax, https에서 Secure 쿠키. DB에는 토큰 해시만 저장.
- **CSRF**: 다른 출처의 요청 거부 + POST는 JSON만.
- **헤더**: CSP(요청마다 nonce), X-Frame-Options, nosniff, HSTS(https).
- **레이트 리밋**: 로그인 요청, 로그인 확인, 태그, 메시지, 체크인, 키링 등록.
- **가입 동의**: 만 14세 이상·약관·처리방침 동의 없이는 가입 불가, 동의 버전과 일시 기록.
- **보관 기간 자동 삭제**: 로그인 기록 3개월, 신고 1년, 만료된 로그인 링크·세션은 1시간마다 정리.
- **신고·이용 정지**: 정지된 계정은 로그인 불가, 명함은 이름만 보이고 키링은 열리지 않으며 이벤트 보드에서도 빠진다.
- **개인정보**: 공개 범위 3단계(기본 "만난 사람만"), 힌트는 행사 시간에만, 리더보드는 동의자만, 고객사 리포트는 통계만, 탈퇴 시 개인정보 삭제.

## 운영 전에 남은 일

- [ ] 메일 발송 연결 (`src/server.js`의 `mailer`, 예: Resend / AWS SES)
- [ ] 프론트엔드를 이 API에 연결 (`../prototype.html` 화면 기준)
- [ ] NTAG 424 DNA 칩 프로비저닝 도구 (칩에 SDM 설정 + `deriveTagKey`로 만든 키 기록)
- [ ] 여러 서버로 늘릴 때: 레이트 리밋과 실시간 피드를 Redis로, DB를 Postgres로
- [ ] 개인정보처리방침·이용약관 빈칸 채우기·변호사 검토 (`../legal/`)
