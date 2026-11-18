# Meetcha 디자인

- Figma: [Meetcha 페이지](https://www.figma.com/design/HPmaU9KxZRqvBzcZ5OSuZQ?node-id=882-2)
- 화면 전체 목록과 우선순위: [screens.md](./screens.md)

## 디자인 원칙

| 원칙 | 화면에서 이렇게 |
|---|---|
| 한 화면에 한 가지 일 | 큰 제목 하나, 바닥에 붙은 버튼 하나. 보조 행동은 글자 버튼이나 두 번째 버튼으로 |
| 묻지 말고 확인하게 | 주최사 명단으로 이름·직함·소속을 미리 채우고 "불러옴" 표시. 사용자는 확인만 |
| 숫자는 문장으로 | "7/24" 대신 "24명 중 7명을 만났어요" |
| 축하는 한 번에 몰아서 | 색종이·카드 뒤집기·햅틱은 새 사람 발견(A2)과 퀴즈 정답에만 |
| 틀려도 그 사람 이야기로 끝내기 | 퀴즈 정답 공개 때 상대의 한 줄 소개를 다시 보여 줌 |
| 남의 얼굴은 남의 것 | 공유 이미지, 대형 화면에는 다른 참가자 얼굴을 넣지 않음 |
| Kahoot과 다르게 | 퀴즈 보기는 2×2 색깔 도형이 아니라 세로로 쌓인 큰 카드 |

## 디자인 토큰 (Figma 변수 `Meetcha` 컬렉션)

| 역할 | 값 |
|---|---|
| 배경 | `bg/base` #F2F4F6 · `bg/surface` #FFFFFF · `bg/subtle` #F9FAFB |
| 글자 | `text/primary` #191F28 · `secondary` #4E5968 · `tertiary` #8B95A1 · `disabled` #B0B8C1 |
| 브랜드 (Meetcha 바이올렛) | `brand/default` #5B47FB · `strong` #4632E0 · `weak` #EFEDFF · `soft` #D9D3FF |
| 가려진 카드 | `fog/default` #1E2130 · `fog/raised` #2A2E42 · `fog/text` #8D93B5 |
| 상태 | `success` #14B885 · `danger` #F04452 · `warning` #FFB020 |
| 모서리 | 8 / 12 / 16 / 24 / 원형 |
| 간격 | 4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 |

글꼴은 **Pretendard**. 텍스트 스타일 `Meetcha/Display`(44) · `Title1`(26) · `Title2`(22) · `Title3`(18) · `Body1`(17) · `Body2`(15) · `Caption`(13) · `Label`(12). 화면 기준 크기는 390×844.

행사 테마 색(`theme.color`)은 `brand/*` 자리를 덮어쓴다.

## 컴포넌트

Button(Primary·Secondary·Neutral × Large·Medium), Avatar(S·M·L·XL), Chip(Brand·Neutral·Fog·Success·Onbrand), SlotCard(Hidden·Found), QuizOption(Default·Selected·Correct·Wrong·Dimmed), TopBar(Back·Close), StatusBar, HomeIndicator, Toast, ProgressBar

## 그린 화면 (14개)

| 흐름 | 화면 |
|---|---|
| Flow 1 처음 받은 키링 → 등록 → 체크인 | A3 키링 등록 · B1 이메일 · B2 가입 동의(바텀시트) · C1 내 정보 확인 · C3 퀴즈 만들기 |
| Flow 2 행사장에서 | A1 로그인 전 태그 · D2 발견 보드 · A2 새 사람 발견 · E2 만난 사람 명함 |
| Flow 3 행사 후 | E5 행사 리캡 · E3 퀴즈 문제 · E3 정답 공개 · E4 퀴즈 결과 · E1 도감 |

각 화면 위에 UX 의도를 적어 두었다. 나머지 화면(설정, 메시지, 신고, 운영진 콘솔 등)은 같은 컴포넌트로 만든다.
