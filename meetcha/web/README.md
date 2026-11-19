# Meetcha 참가자 화면 (모바일 웹)

NFC 키링을 태그하면 앱 설치 없이 바로 열리는 화면. React + Vite. 디자인은 [Figma Meetcha 페이지](https://www.figma.com/design/HPmaU9KxZRqvBzcZ5OSuZQ?node-id=882-2)와 [`../design/`](../design/README.md)의 토큰을 그대로 따른다.

## 실행

```bash
# 1) 서버 (다른 터미널)
cd meetcha/server
APP_ORIGIN=http://localhost:5173 ADMIN_EMAILS=me@example.com npm run dev

# 2) 화면 (개발 서버, 저장하면 바로 반영)
cd meetcha/web
npm install
npm run dev          # http://localhost:5173
```

로그인 링크는 서버 터미널에 출력된다. `npm run seed`(서버 폴더)로 예시 참가자·키링·행사를 만들 수 있다.

**배포용**: `npm run build` → `dist/`가 생기고, 서버가 `meetcha/web/dist`를 자동으로 서비스한다(다른 위치면 `WEB_DIST` 환경 변수). 화면과 API가 같은 주소라 로그인 쿠키와 보안 검사가 그대로 동작한다.

## 화면

| 주소 | 화면 (screens.md 코드) |
|---|---|
| `/` | 첫 화면. 로그인했으면 진행 중인 행사 보드 → 도감 → 내 명함 순으로 이동 |
| `/login` | B1 이메일로 시작 |
| `/auth/verify` | B2 메일 링크 확인 + 처음이면 동의 바텀시트 |
| `/claim` | A3 행사용 키링 등록 (키링을 처음 태그하면 서버가 보냄) |
| `/onboarding` | C1~C3 내 정보 확인 → 행사 힌트·사진 → 내 퀴즈 |
| `/board`, `/events/:id` | D2 발견 보드 (실시간 피드, 토스트), 체크인 코드 입력 |
| `/u/:id` | A1 로그인 전 태그 / E2 만난 사람 명함 / `?new=1`이면 A2 새 사람 발견 연출 |
| `/quiz/:userId` | E3 퀴즈(10초 타이머, 서버 채점) → E4 결과 |
| `/events/:id/recap` | E5 행사 리캡 (공유 이미지) |
| `/dex` | E1 도감 (행사별, 검색, 연락처 저장) |
| `/me` | 내 명함 편집, 내 퀴즈, 키링·분실 신고, 화면 모드, 로그아웃·탈퇴 |

## 구조

```
src/
  styles/tokens.css   Figma 변수(Light/Dark), 텍스트 스타일, 그라데이션·그레인
  styles/app.css      컴포넌트 스타일 (Button, Chip, SlotCard, QuizOption, Sheet…)
  components/ui.jsx   공용 부품 (Screen, TopBar, Avatar, Slot, TabBar, Sheet, Toast…)
  components/QuizEditor.jsx
  lib/api.js          API 호출 (POST는 항상 JSON — 서버 출처 검사 규칙)
  lib/session.jsx     로그인 상태
  lib/theme.js        라이트/다크 (기본: 기기 설정)
  lib/useEventStream.js  행사 실시간 피드(SSE)
  pages/              화면들
```

## 글꼴

`font-family: "Helvetica Neue", "Pretendard Variable", …` — 영문·숫자는 기기에 Helvetica Neue가 있으면(iPhone·Mac) 그걸로, 없으면 Pretendard로 그린다. Pretendard는 `pretendard` 패키지에서 필요한 글자만 나눠 받는(subset) 방식으로 함께 빌드된다.

## 확인한 것

Playwright로 실제 서버 + 빌드된 화면을 390×844에서 처음부터 끝까지 눌러 봄 (라이트·다크):

1. 로그인 전 태그 → 로그인 → 동의 → 온보딩 3단계 → 태그했던 사람이 도감에 저장됨
2. 체크인 코드 → 발견 보드 → 다른 사람 키링 태그 → 새 사람 발견 연출 → 명함 → 퀴즈 → 결과
3. 리캡, 도감, 내 명함, 다크 모드
4. 운영진이 행사용 키링 발급 → 새 참가자가 태그 → 가입 → 등록 + 체크인 → 보드

## 아직 안 한 것

- 화면 자동 테스트를 저장소에 넣기 (지금은 수동 실행 스크립트로 확인)
- 운영진 콘솔 화면 (H1~H10), 받은 메시지함(F1), 행사장 대형 화면
- 영문 화면 (문구 분리)
