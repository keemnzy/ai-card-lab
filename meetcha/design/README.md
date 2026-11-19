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

## 브랜드 컬러: Neon Petal, Light / Dark

한 브랜드, 두 모드. **메인 컬러의 역할은 두 모드에서 같고, 바탕만 바뀐다.** Figma 변수 `Meetcha` 컬렉션의 `Light` / `Dark` 모드로 관리한다.

| 역할 | 색 | 어디에 |
|---|---|---|
| **핑크 = 행동** | #E11D6C (흰 글씨 대비 4.6:1을 위해 #EC2B7A보다 살짝 진하게) | 메인 버튼, 진행, 선택된 상태 |
| **연두 = 보상** | 차트리우스 #CEFF32 (항상 검정 글씨, 대비 14:1) | 새 사람 발견 버튼·배지, 퀴즈 정답, 점수, 리캡 숫자 |
| 보조 | 핑크 카네이션 #FE7BBF | 연한 강조, 그라데이션 중간 |

| 모드 | 바탕 | 카드 | 글자 | 핑크 글자(보조 버튼·칩) |
|---|---|---|---|---|
| Light | #F4F4F7 | #FFFFFF | #14151F | #C2125A (진하게) |
| Dark | 블랙 러시안 #000215 | #0D0F24 | #F5F5FA | #FF3D8B (밝게) |

규칙
- 모드는 기본으로 휴대폰 설정을 따르고, 주최사가 행사 기본값을 정할 수 있다 (밤 밋업은 Dark).
- 차트리우스는 흰 바탕 위 글자로 쓰지 않는다.
- 네온은 "순간"에만: 새 사람 발견, 퀴즈 정답, 리캡 숫자, 진행 바. 입력·설정 화면은 차분하게.
- 바이올렛은 Kahoot, 오렌지는 Eventbrite 대표색과 겹쳐서 후보에서 뺐다.

## 그라데이션 + 그레인

- 쓰는 곳: 새 사람 발견 배경, 리캡 히어로, 발견 보드 상단의 은은한 빛, 진행 바, 공유 이미지, 키링 포장. 일반 화면엔 쓰지 않는다.
- 그라데이션: 핑크 #EC2B7A → 핑크 카네이션 #FE7BBF → 차트리우스 #CEFF32. 밝은 안은 세로 선형, 어두운 안은 블랙 러시안 위에 핑크(왼쪽 위)·연두(오른쪽 아래) 원형 빛.
- 그레인: Figma Noise 효과(Monotone, 크기 0.5, 밀도 0.7, 밝은 바탕 검정 16% / 어두운 바탕 흰색 10%). 그라데이션 레이어에만 건다.
- 웹 구현: 그라데이션은 CSS `radial-gradient` 여러 겹, 그레인은 작은 노이즈 PNG(또는 SVG `feTurbulence`)를 `mix-blend-mode: overlay`로 덮는다.

## 글꼴

- 한글: **Pretendard**
- 영문·숫자: **Helvetica Neue** (텍스트 스타일 `Meetcha/EN/*`). 이 Figma 환경에는 Helvetica Neue가 없어서 지금은 Inter로 들어가 있다. Helvetica Neue가 설치된 Mac의 Figma에서 `Meetcha/EN/*` 스타일 10개의 글꼴만 바꾸면 모든 화면에 반영된다.
- 웹 구현: `font-family: "Helvetica Neue", Pretendard, Arial, sans-serif;`. 브라우저가 영문은 Helvetica Neue, 한글은 Pretendard로 그린다. iPhone·Mac에는 Helvetica Neue가 기본으로 있어서 바로 보이고, Android·Windows에서는 Arial로 대체된다.
- 라이선스 주의: Helvetica Neue는 유료 글꼴(Monotype)이라 웹폰트 파일로 직접 올려 쓰려면 웹 라이선스가 필요하다. 사용자 기기에 있는 글꼴을 부르는 방식(위 CSS)은 라이선스가 필요 없다. 모든 기기에서 같은 모양이 필요하면 무료 대체(Inter, Hanken Grotesk 등)를 검토.

## 디자인 토큰 (Figma 변수 `Meetcha` 컬렉션)

| 토큰 | Light | Dark |
|---|---|---|
| `bg/base` · `bg/surface` · `bg/subtle` | #F4F4F7 · #FFFFFF · #FAFAFC | #000215 · #0D0F24 · #14162D |
| `text/primary` · `secondary` · `tertiary` · `disabled` | #14151F · #4A4D5E · #8A8D9C · #B6B8C3 | #F5F5FA · #B7B9CC · #7D809A · #4E5170 |
| `text/onBrand` · `onAccent` · `onDark` | #FFFFFF · #14151F · #FFFFFF | #FFFFFF · #0A0B14 · #FFFFFF |
| `line/default` · `line/strong` | #E6E6EC · #D2D3DB | #1F2238 · #30344E |
| `brand/default` (핑크, 행동) | #E11D6C | #E11D6C |
| `brand/strong` · `weak` · `soft` | #C2125A · #FFE8F2 · #FE7BBF | #FF3D8B · #2A0B19 · #FE7BBF |
| `accent/default` (연두, 보상) · `accent/weak` | #CEFF32 · #F4FFD6 | #CEFF32 · #1E240C |
| `fog/default` · `raised` · `text` (가려진 카드) | #0B0C1F · #1E2035 · #9A9DB8 | #15172E · #22253F · #8D90AE |
| `success` · `danger` · `warning` | #14B885 · #F04452 · #FFB020 | #4ADE80 · #FF5A67 · #FFC14D |
| 모서리 | 8 / 12 / 16 / 24 / 원형 |
| 간격 | 4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 |

글꼴은 **Pretendard**. 텍스트 스타일 `Meetcha/Display`(44) · `Title1`(26) · `Title2`(22) · `Title3`(18) · `Body1`(17) · `Body2`(15) · `Caption`(13) · `Label`(12). 화면 기준 크기는 390×844.

행사 테마 색(`theme.color`)은 `brand/*` 자리를 덮어쓴다.

## 컴포넌트

Button(Primary·Secondary·Neutral × Large·Medium), Avatar(S·M·L·XL), Chip(Brand·Neutral·Fog·Success·Onbrand), SlotCard(Hidden·Found), QuizOption(Default·Selected·Correct·Wrong·Dimmed), TopBar(Back·Close), StatusBar, HomeIndicator, Toast, ProgressBar

## 그린 화면 (14개 + 색 비교 6개)

| 흐름 | 화면 |
|---|---|
| Flow 1 처음 받은 키링 → 등록 → 체크인 | A3 키링 등록 · B1 이메일 · B2 가입 동의(바텀시트) · C1 내 정보 확인 · C3 퀴즈 만들기 |
| Flow 2 행사장에서 | A1 로그인 전 태그 · D2 발견 보드 · A2 새 사람 발견 · E2 만난 사람 명함 |
| Flow 3 행사 후 | E5 행사 리캡 · E3 퀴즈 문제 · E3 정답 공개 · E4 퀴즈 결과 · E1 도감 |

컬러 시스템: `Meetcha 컬러 시스템 · Light / Dark` 프레임에 발견 보드·새 사람 발견·리캡을 Light·Dark 모드로 나란히 두었다. Flow 1~3의 화면들은 Light 모드다.

각 화면 위에 UX 의도를 적어 두었다. 나머지 화면(설정, 메시지, 신고, 운영진 콘솔 등)은 같은 컴포넌트로 만든다.
