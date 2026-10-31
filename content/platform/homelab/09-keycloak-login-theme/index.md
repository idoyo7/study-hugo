---
title: "09 Keycloak 로그인 — 개인 Gmail 연동과 테마 시안 53장"
date: 2026-10-31
lastmod: 2026-10-31
weight: 9
url: "/homelab/09-keycloak-login-theme/"
---

# Keycloak 로그인 — 개인 Gmail 연동과 테마 시안 53장

홈랩 서비스는 Keycloak 하나로 로그인합니다. Grafana, Argo CD, code-server, Memos 같은 앱이 전부 같은 realm을 씁니다. 그런데 로그인 화면은 Keycloak 기본 그대로였고, 비밀번호 폼 아래에는 값이 비어 있어 눌러도 동작하지 않는 Google 버튼이 붙어 있었습니다.

이 글은 2026-10-31 하루 동안 한 일을 정리한 기록입니다. 먼저 개인 Gmail 계정으로 Google 로그인을 붙였고, 이어서 로그인 화면 시안 53장을 만들어 비교한 뒤 하나를 골라 실제 테마로 적용했습니다.

## Google 로그인에 Workspace는 필요 없다

처음에는 Google Workspace가 있어야 붙일 수 있다고 생각했습니다. realm 설정에 이미 Google IdP가 있었는데 `hostedDomain`에 회사 도메인이 걸려 있었기 때문입니다. 회사 계정으로 시험하던 흔적이었습니다.

Keycloak의 Google IdP는 일반 OIDC 로그인이라 개인 Gmail로 만든 GCP 프로젝트의 OAuth 클라이언트로 충분합니다. Workspace가 필요한 건 다음 경우뿐입니다.

| 기능 | 개인 Gmail | Workspace |
|---|---|---|
| Keycloak에 Google 로그인 붙이기 (OIDC) | 가능 | 가능 |
| 동의 화면을 Internal로 두기 | 불가, External만 | 가능 |
| `hd`로 특정 도메인 계정만 받기 | 불가 | 가능 |
| Google을 SAML IdP로 쓰기 | 불가 | 가능 |

GCP 쪽 설정은 세 가지였습니다.

- OAuth 동의 화면을 External로 만들고 게시 상태는 Testing으로 둡니다. Testing에서는 테스트 사용자로 등록한 계정만 로그인할 수 있어서, 이 목록이 Workspace의 Internal과 거의 같은 허용 목록 역할을 합니다.
- 웹 애플리케이션 유형의 OAuth 클라이언트를 만듭니다.
- 승인된 리디렉션 URI에는 `https://<keycloak>/realms/<realm>/broker/google/endpoint`를 넣습니다.

### 새 계정은 만들지 않고 기존 계정에만 연결

Keycloak 기본 first broker login flow는 Google 계정과 이메일이 같은 사용자가 없으면 새 사용자를 만듭니다. 홈랩에는 가입이 필요 없고, 이미 있는 계정에 Google을 붙이고 싶었을 뿐입니다. 그래서 단계 두 개짜리 flow를 새로 만들었습니다.

```json
{
  "alias": "link existing user only",
  "providerId": "basic-flow",
  "topLevel": true,
  "builtIn": false,
  "authenticationExecutions": [
    { "authenticator": "idp-detect-existing-broker-user", "requirement": "REQUIRED", "priority": 10 },
    { "authenticator": "idp-auto-link",                    "requirement": "REQUIRED", "priority": 20 }
  ]
}
```

`idp-detect-existing-broker-user`는 이메일이 같은 기존 사용자를 찾지 못하면 그 자리에서 실패합니다. 찾으면 `idp-auto-link`가 Google 계정을 그 사용자에게 연결합니다. Google IdP의 `firstBrokerLoginFlowAlias`를 이 flow로 바꾸고 `hostedDomain`은 지웠습니다.

이 홈랩의 realm은 Keycloak 관리 화면에서 고치지 않습니다. Helm values 안의 JSON을 keycloak-config-cli가 sync할 때마다 다시 적용하기 때문에, 화면에서 바꾸면 다음 sync에 되돌아갑니다. flow 정의도 같은 JSON에 넣었습니다. 배포 전에는 같은 JSON으로 임시 realm을 만들어 Keycloak이 받아들이는지 시험하고 바로 지웠습니다.

Keycloak 이메일과 Google 이메일이 다른 사용자도 한 명 있었습니다. 이 경우는 자동 연결로 풀리지 않습니다. Google 쪽 사용자 ID(sub)는 첫 로그인 전에는 알 수 없어서 미리 넣어 둘 수도 없습니다. 그 사용자가 비밀번호로 계정 콘솔에 들어가 연결된 계정 메뉴에서 Google을 직접 연결하는 방법이 가장 단순했습니다. 이 경로는 first broker login을 거치지 않고, 지금 로그인한 계정에 바로 연결합니다.

쓰지 않던 Okta IdP는 끄고, 로그인 화면에는 Google 버튼 하나만 남겼습니다.

## 로그인 화면 시안 53장

기능이 붙고 나니 화면이 눈에 걸렸습니다. Keycloak 테마는 손볼 수 있는 범위가 단계별로 나뉩니다.

1. realm 설정만 바꾸기: IdP 표시 이름이나 순서 정도만 바뀝니다.
2. 기본 테마를 상속하고 CSS만 덮어쓰기
3. `template.ftl`, `login.ftl` 같은 FreeMarker 템플릿까지 고치기
4. Keycloakify처럼 React로 테마를 새로 만들어 JAR로 넣기

어느 단계로 갈지 정하기 전에 시안부터 많이 만들어 봤습니다. 전부 디자인 캔버스에 올려 두었고 [공개 캔버스](https://claude.ai/artifact/KDRN8tsqUk3hN75344b5n6)에서 직접 볼 수 있습니다. 아래 스크린샷은 그 캔버스의 시안을 헤드리스 Chromium으로 한 장씩 찍은 것입니다. 이 환경에 한글 시스템 폰트가 없어서, 한글 웹폰트를 지정하지 않은 자리는 Noto Sans KR로 대신 그렸습니다.

공개용으로 계정 이름은 `user1`·`user2`로, 서비스 주소는 용도 설명으로 바꿨습니다.

### 처음 네 장

기본 테마와, Google 버튼을 앞에 두는 몇 가지 배치를 비교했습니다. B와 D는 비밀번호 폼을 접어 두고 필요할 때만 펼치는 구성입니다.

![A. 지금 모습 (keycloak.v2 기본)](/images/keycloak-theme/main.png)

![B. Google 우선 + 비밀번호 접기](/images/keycloak-theme/google-first.png)

![C. 좌우 분할 브랜드 패널](/images/keycloak-theme/split.png)

![D. 다크 터미널 톤](/images/keycloak-theme/terminal.png)

### 커뮤니티에서 많이 쓰는 테마 스타일

많이 쓰이는 오픈소스 테마는 두 갈래입니다. FreeMarker 테마인 [Keywind](https://github.com/lukin/keywind)와, Keycloakify로 만드는 [shadcn/ui 스타터](https://docs.keycloakify.dev/starter-themes/shadcn-ui-tailwind)입니다. Keywind를 Keycloakify로 다시 만든 [Tailcloakify](https://github.com/ALMiG-Kompressoren-GmbH/tailcloakify)도 있습니다. 원본 미리보기를 보고 같은 느낌으로 옮긴 근사치라 간격과 색은 원본과 조금 다릅니다.

![E. Keywind 스타일 (Tailcloakify도 같은 계열)](/images/keycloak-theme/keywind.png)

![F. Keycloakify shadcn 스타터 · 라이트](/images/keycloak-theme/shadcn-light.png)

![G. Keycloakify shadcn 스타터 · 다크](/images/keycloak-theme/shadcn-dark.png)

### 방향을 넓힌 열 장

타이포 중심, 브루탈리즘, 신문 편집 디자인, 홈랩에서 자주 보는 Nord·Catppuccin 팔레트, Material 3, 모바일 바텀시트까지 방향을 넓혔습니다. 상태판(M)과 계정 선택(N) 화면은 Keycloak 기본 기능만으로는 만들 수 없습니다. 실제로 쓰려면 외부 API 연동이나 쿠키 처리를 따로 붙여야 합니다.

![H. 스위스 타이포](/images/keycloak-theme/swiss.png)

![I. 브루탈리즘](/images/keycloak-theme/brutal.png)

![J. 신문 편집 디자인](/images/keycloak-theme/editorial.png)

![K. Nord 팔레트](/images/keycloak-theme/nord.png)

![L. Catppuccin Mocha 팔레트](/images/keycloak-theme/catppuccin.png)

![M. 홈랩 상태판 겸 로그인](/images/keycloak-theme/status.png)

![N. 계정 선택 화면](/images/keycloak-theme/chooser.png)

![O. 둥근 파스텔](/images/keycloak-theme/rounded.png)

![P. Material 3](/images/keycloak-theme/material.png)

![Q. 모바일 바텀시트](/images/keycloak-theme/mobile.png)

### 브루탈리즘과 둥근 파스텔의 색 변주

열 장 가운데 브루탈리즘(I)과 둥근 파스텔(O)이 남았습니다. 레이아웃은 그대로 두고 색만 바꿔 여섯 가지씩 뽑았습니다. 브루탈리즘 원본 오른쪽 위에는 이때부터 블로그와 같은 육각형 로고를 넣었습니다.

![I-1 레몬 (기본)](/images/keycloak-theme/brutal-lemon.png)

![I-2 민트](/images/keycloak-theme/brutal-mint.png)

![I-3 코랄](/images/keycloak-theme/brutal-coral.png)

![I-4 종이 + 파란 잉크](/images/keycloak-theme/brutal-paper.png)

![I-5 다크 + 네온 그림자](/images/keycloak-theme/brutal-night.png)

![I-6 흑백 + 빨강 포인트](/images/keycloak-theme/brutal-mono.png)

![O-1 라벤더 (기본)](/images/keycloak-theme/round-lavender.png)

![O-2 세이지](/images/keycloak-theme/round-sage.png)

![O-3 피치](/images/keycloak-theme/round-peach.png)

![O-4 하늘](/images/keycloak-theme/round-sky.png)

![O-5 버터](/images/keycloak-theme/round-butter.png)

![O-6 밤 (다크)](/images/keycloak-theme/round-night.png)

### 회색 브루탈리즘과 Oblivion 포인트 컬러

배경을 완전한 검정 대신 회색 두 단계(그래파이트, 슬레이트)로 두고, 뒤에 깔리는 네모 그림자에 영화 Oblivion(2013) UI에서 따온 포인트 컬러를 넣었습니다. 시안, 앰버, 드론 경고 레드, 아이스 화이트, 틸, 페일 옐로 여섯 가지입니다.

![I-7 그래파이트 + Oblivion 시안](/images/keycloak-theme/brutal-graphite.png)

![I-8 그래파이트 + Oblivion 앰버](/images/keycloak-theme/brutal-graphite-amber.png)

![I-9 슬레이트 + Oblivion 시안](/images/keycloak-theme/brutal-slate.png)

![I-10 슬레이트 + Oblivion 앰버](/images/keycloak-theme/brutal-slate-amber.png)

![I-11 그래파이트 + 드론 레드](/images/keycloak-theme/brutal-graphite-red.png)

![I-12 그래파이트 + 아이스 화이트](/images/keycloak-theme/brutal-graphite-ice.png)

![I-13 그래파이트 + 틸](/images/keycloak-theme/brutal-graphite-teal.png)

![I-14 그래파이트 + 페일 옐로](/images/keycloak-theme/brutal-graphite-yellow.png)

![I-15 슬레이트 + 드론 레드](/images/keycloak-theme/brutal-slate-red.png)

![I-16 슬레이트 + 아이스 화이트](/images/keycloak-theme/brutal-slate-ice.png)

![I-17 슬레이트 + 틸](/images/keycloak-theme/brutal-slate-teal.png)

![I-18 슬레이트 + 페일 옐로](/images/keycloak-theme/brutal-slate-yellow.png)

### Oblivion HUD

같은 영화의 HUD에서 분위기를 가져와 레이아웃을 새로 짰습니다. 얇은 원형 조준선 가운데에 로고를 두고, 모서리 괄호와 모노스페이스 라벨, 가는 서체의 밑줄형 입력칸을 썼습니다. 라이트에서 시작해 다크로 뒤집었고, 회색을 몇 단계 밝히거나 연두빛을 섞은 버전도 만들었습니다.

![R. Oblivion HUD · 라이트](/images/keycloak-theme/oblivion-hud.png)

![R-2 · 다크 (#1a2026)](/images/keycloak-theme/oblivion-hud-dark.png)

![R-3 · 스모크 그레이 + 시안](/images/keycloak-theme/hud-smoke.png)

![R-4 · 애시 그레이 + 시안 (더 밝게)](/images/keycloak-theme/hud-ash.png)

![R-5 · 연두빛 회색 배경 + 시안](/images/keycloak-theme/hud-moss.png)

![R-6 · 스모크 그레이 + 연두 포인트](/images/keycloak-theme/hud-lime.png)

### 사이버펑크

마지막으로 사이버펑크 장르의 공통 요소만 써서 두 가지 레이아웃을 만들었습니다. 특정 게임의 UI는 따라 하지 않았습니다. 컷 패널은 두 네온 색을 어긋나게 겹친 글리치 타이틀, 사선으로 잘린 모서리, 스캔라인으로 구성했습니다. 네온 사인은 빛이 번지는 간판 글자와 네온 테두리 카드입니다.

![C-1 사이버펑크 컷 패널 · 마젠타/시안](/images/keycloak-theme/cyber-cut.png)

![C-2 컷 패널 · 경고 옐로](/images/keycloak-theme/cyber-yellow.png)

![C-3 컷 패널 · 레드/오렌지](/images/keycloak-theme/cyber-red.png)

![C-4 컷 패널 · 애시드 그린/퍼플](/images/keycloak-theme/cyber-green.png)

![C-5 네온 사인 · 핑크](/images/keycloak-theme/cyber-neon.png)

![C-6 네온 사인 · 블루](/images/keycloak-theme/cyber-neon-blue.png)

## 고른 것: Oblivion HUD 다크

최종 선택은 HUD 다크(R-2)였습니다. 라벨은 `USER ID`·`PASSPHRASE` 대신 평범하게 `ID`·`PASSWORD`로 바꿨습니다. 시안에 있던 `RESET` 링크는 뺐습니다. Keycloak 기본 화면에도 "Forgot Password?"가 떠 있었는데, 이 realm에는 SMTP가 설정돼 있지 않아 메일이 나가지 않습니다. 동작하지 않는 버튼이었던 셈이라 realm의 `resetPasswordAllowed`도 함께 껐습니다.

![sso 로그인 화면에 적용된 HUD 다크 테마 — 왼쪽에 원형 조준선과 육각형 로고, 오른쪽에 MAKGOL SPACE 제목, GOOGLE 인증 버튼, ID·PASSWORD 입력칸, ENTER 버튼](/images/keycloak-theme/live-sso.png)

모바일 폭에서는 조준선이 위로 올라가 작아지고 폼이 그 아래로 쌓입니다. 로그인 외의 페이지(에러, 로그아웃 확인, 비밀번호 변경, 만료)도 같은 틀 안에서 렌더링됩니다.

![폭 390px에서 본 HUD 테마 — 조준선이 위에 작게, 그 아래로 제목과 입력칸이 세로로 쌓인다](/images/keycloak-theme/live-mobile.png)

![존재하지 않는 client_id로 들어갔을 때의 에러 페이지 — 같은 HUD 틀에 WE ARE SORRY 부제와 Client not found 문구](/images/keycloak-theme/live-error.png)

### 테마 구조

빌드 과정이 없도록 FreeMarker 테마로 만들고, 파일을 세 개로 줄였습니다.

| 파일 | 역할 |
|---|---|
| `login/theme.properties` | `parent=base`, `import=common/keycloak`. 모든 `kc*Class`를 `hud-*` 클래스로 매핑해서 PatternFly 없이 base 페이지를 그립니다. |
| `login/template.ftl` | `registrationLayout` 매크로. HUD 틀, 조준선 SVG, 로고, CSS 전체를 인라인으로 담습니다. |
| `login/login.ftl` | 로그인 폼. `social.providers`를 돌며 Google 버튼을 위에 두고, ID·PASSWORD와 ENTER를 그립니다. |

CSS와 로고를 파일로 따로 두지 않은 이유는 ConfigMap 하나에 하위 디렉터리 없이 담기 위해서입니다. 이 ConfigMap을 Keycloak 두 벌(bitnami 차트의 현재 운영 인스턴스와 이관 중인 keycloakx 인스턴스)의 `themes/makgol-hud/login`에 마운트하고, realm JSON의 `loginTheme`을 `makgol-hud`로 바꿨습니다.

### 적용하면서 걸린 것

- **base 템플릿을 그대로 베끼면 26.3에서 깨집니다.** Keycloak 26.7의 base `template.ftl`은 `theme-resources.ftl`, `?c`, `outputformat`을 쓰는데 26.3.3에는 이 기능들이 없습니다. 운영 인스턴스가 26.3.3, 이관 대상이 26.7.4라서 둘 다에서 동작하도록 이 세 가지를 쓰지 않았습니다. `authSessionIdHash`가 26.3에서는 문자열, 26.7에서는 숫자인 차이도 양쪽 다 처리했습니다.
- **배포 전에 임시 네임스페이스에서 두 버전을 모두 띄워 봤습니다.** `start-dev`로 26.3.3과 26.7.4를 띄우고, 테스트 realm에서 로그인 화면, 틀린 비밀번호 재렌더링, 없는 client_id 에러, 로그아웃 확인과 비밀번호 변경 화면을 curl로 확인했습니다. FreeMarker 오류가 없는지는 로그로 봤습니다.
- **Google 버튼만 20px 안쪽으로 밀려 있었습니다.** 템플릿의 `.hud-panel ul { padding-left: 20px }`가 `.hud-social { padding: 0 }`보다 구체적인 선택자라서 이겼습니다. 렌더링 결과를 스크린샷으로 확인하다가 발견했고, `.hud-panel ul.hud-social`로 선택자를 맞춰 고쳤습니다.
- **ConfigMap을 바꾸면 파드를 재시작해야 합니다.** 운영 모드 Keycloak은 테마를 캐시합니다. 이번에는 볼륨 마운트가 새로 생기면서 StatefulSet이 저절로 롤링됐지만, 나중에 CSS만 고칠 때는 직접 재시작해야 합니다.
- **ConfigMap을 먼저 만들어야 합니다.** ConfigMap은 keycloakx 앱의 보조 차트가 만들고, 운영 인스턴스는 그 ConfigMap을 이름으로 마운트합니다. 그래서 테마 저장소를 먼저 푸시해 ConfigMap이 생긴 걸 확인한 다음 values 저장소를 푸시했습니다. 운영 쪽 마운트는 `optional: true`로 둬서, 순서가 꼬여도 파드가 ContainerCreating에 멈추지 않게 했습니다.

## 테마 파일

세 파일 전문입니다. 같은 파일을 이 글 폴더의 [makgol-hud/login/](makgol-hud/login/template.ftl)에도 넣어 두었습니다. 색은 `template.ftl` 위쪽 CSS 변수에 모여 있습니다.

{{< details title="login/theme.properties" closed="true" >}}
```properties
# makgol-hud login theme. Markup comes from the base theme, CSS is inline in template.ftl.
# Every kc*Class maps to a hud-* class so the stock base pages get the HUD look without PatternFly.
parent=base
import=common/keycloak

meta=viewport==width=device-width,initial-scale=1

kcHtmlClass=hud-html
kcLoginClass=hud-login
kcContainerClass=hud-container
kcContentClass=hud-content
kcHeaderClass=hud-header
kcLocaleClass=hud-locale
kcLocaleMainClass=hud-locale-main
kcLocaleListClass=hud-locale-list
kcLocaleItemClass=hud-locale-item
kcAlertClass=hud-alert
kcAlertTitleClass=hud-alert-title
kcFormAreaClass=hud-form-area
kcFormCardClass=hud-form-card
kcFormSocialAccountListClass=hud-form-social-account-list
kcFormSocialAccountListGridClass=hud-form-social-account-list-grid
kcFormSocialAccountListButtonClass=hud-form-social-account-list-button
kcFormSocialAccountListButtonDisabledClass=hud-form-social-account-list-button-disabled
kcFormSocialAccountGridItem=hud-form-social-account-grid-item
kcFormSocialAccountNameClass=hud-form-social-account-name
kcFormSocialAccountLinkClass=hud-form-social-account-link
kcFormSocialAccountSectionClass=hud-form-social-account-section
kcFormHeaderClass=hud-form-header
kcFormClass=hud-form
kcFormGroupClass=hud-form-group
kcFormGroupErrorClass=hud-form-group-error
kcLabelClass=hud-label
kcLabelWrapperClass=hud-label-wrapper
kcInputClass=hud-input
kcInputHelperTextBeforeClass=hud-input-helper-text-before
kcInputHelperTextAfterClass=hud-input-helper-text-after
kcInputClassRadio=hud-input-class-radio
kcInputClassRadioInput=hud-input-class-radio-input
kcInputClassRadioLabel=hud-input-class-radio-label
kcInputClassCheckbox=hud-input-class-checkbox
kcInputClassCheckboxInput=hud-input-class-checkbox-input
kcInputClassCheckboxLabel=hud-input-class-checkbox-label
kcInputClassRadioCheckboxLabelDisabled=hud-input-class-radio-checkbox-label-disabled
kcInputErrorMessageClass=hud-msg hud-msg-error
kcInputGroup=hud-input-group
kcInputWrapperClass=hud-input-wrapper
kcFormOptionsClass=hud-form-options
kcFormButtonsClass=hud-form-buttons
kcFormSettingClass=hud-settings
kcTextareaClass=hud-textarea
kcSignUpClass=hud-sign-up
kcInfoAreaClass=hud-info-area
kcFormGroupHeader=hud-form-group-header
kcButtonClass=hud-button
kcButtonPrimaryClass=hud-btn-primary
kcButtonDefaultClass=hud-btn-secondary
kcButtonLargeClass=hud-btn-lg
kcButtonBlockClass=hud-btn-block
kcInputLargeClass=hud-input-large
kcSrOnlyClass=hud-sr-only
kcSelectAuthListClass=hud-select-auth-list
kcSelectAuthListItemClass=hud-select-auth-list-item
kcSelectAuthListItemBodyClass=hud-select-auth-list-item-body
kcSelectAuthListItemHeadingClass=hud-select-auth-list-item-heading
kcSelectAuthListItemDescriptionClass=hud-select-auth-list-item-description
kcSelectAuthListItemFillClass=hud-select-auth-list-item-fill
kcSelectAuthListItemArrowClass=hud-select-auth-list-item-arrow
kcSelectAuthListItemTitle=hud-select-auth-list-item-title
kcLoginOTPListClass=hud-login-o-t-p-list
kcLoginOTPListInputClass=hud-login-o-t-p-list-input
kcLoginOTPListItemHeaderClass=hud-login-o-t-p-list-item-header
kcLoginOTPListItemTitleClass=hud-login-o-t-p-list-item-title
kcCommonLogoIdP=hud-idp-logo
kcRecoveryCodesWarning=hud-recovery-codes-warning
kcRecoveryCodesList=hud-recovery-codes-list
kcRecoveryCodesActions=hud-recovery-codes-actions
kcRecoveryCodesConfirmation=hud-recovery-codes-confirmation
kcCheckClass=hud-check
kcCheckInputClass=hud-check-input
kcCheckLabelClass=hud-check-label
kcFormPasswordVisibilityButtonClass=hud-eye-btn
kcFormPasswordVisibilityIconShow=hud-eye hud-eye-show
kcFormPasswordVisibilityIconHide=hud-eye hud-eye-hide
kcBodyClass=hud-body
kcButtonSecondaryClass=hud-button-secondary
kcCheckboxInputClass=hud-checkbox-input
kcContentWrapperClass=hud-content-wrapper
kcFormButtonsWrapperClass=hud-form-buttons-wrapper
kcFormOptionsWrapperClass=hud-form-options-wrapper
kcHeaderWrapperClass=hud-header-wrapper
kcInfoAreaWrapperClass=hud-info-area-wrapper
kcLocaleDropDownClass=hud-locale-drop-down
kcLocaleListItemClass=hud-locale-list-item
kcLocaleWrapperClass=hud-locale-wrapper
kcMarginTopClass=hud-margin-top
```
{{< /details >}}

{{< details title="login/login.ftl" closed="true" >}}
```html
<#import "template.ftl" as layout>
<#import "passkeys.ftl" as passkeys>
<@layout.registrationLayout displayMessage=!messagesPerField.existsError('username','password') displayInfo=realm.password && realm.registrationAllowed && !registrationDisabled??; section>
    <#if section = "header">
        <#-- empty: the HUD title already says what this page is -->
    <#elseif section = "form">
        <#if realm.password && social?? && social.providers?has_content>
            <ul id="kc-social-providers" class="hud-social">
                <#list social.providers as p>
                    <li>
                        <a data-once-link data-disabled-class="disabled" id="social-${p.alias}"
                           class="hud-btn hud-social-btn" href="${p.loginUrl}">
                            <#if p.alias == "google" || p.providerId == "google">
                                <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path></svg>
                                <span>GOOGLE 인증</span>
                            <#else>
                                <span>${p.displayName!}</span>
                            </#if>
                        </a>
                    </li>
                </#list>
            </ul>
        </#if>
        <#if realm.password>
            <form id="kc-form-login" class="hud-body-area" onsubmit="login.disabled = true; return true;" action="${url.loginAction}" method="post">
                <#if !usernameHidden??>
                    <div class="hud-field">
                        <label for="username" class="hud-label">ID</label>
                        <input tabindex="2" id="username" name="username" value="${(login.username!'')}" type="text"
                               autofocus autocomplete="${(enableWebAuthnConditionalUI?has_content)?then('username webauthn', 'username')}"
                               autocapitalize="none" spellcheck="false"
                               aria-invalid="<#if messagesPerField.existsError('username','password')>true<#else>false</#if>"
                               dir="ltr"
                        />
                    </div>
                </#if>

                <div class="hud-field">
                    <label for="password" class="hud-label">PASSWORD</label>
                    <div class="${properties.kcInputGroup!}" dir="ltr">
                        <input tabindex="3" id="password" name="password" type="password" autocomplete="current-password"
                               aria-invalid="<#if messagesPerField.existsError('username','password')>true<#else>false</#if>"
                        />
                        <button class="${properties.kcFormPasswordVisibilityButtonClass!}" type="button" aria-label="${msg("showPassword")}"
                                aria-controls="password" data-password-toggle tabindex="4"
                                data-icon-show="${properties.kcFormPasswordVisibilityIconShow!}" data-icon-hide="${properties.kcFormPasswordVisibilityIconHide!}"
                                data-label-show="${msg('showPassword')}" data-label-hide="${msg('hidePassword')}">
                            <i class="${properties.kcFormPasswordVisibilityIconShow!}" aria-hidden="true"></i>
                        </button>
                    </div>
                </div>

                <#if messagesPerField.existsError('username','password')>
                    <p id="input-error" class="hud-msg hud-msg-error" role="alert" aria-live="polite">${kcSanitize(messagesPerField.getFirstError('username','password'))?no_esc}</p>
                </#if>

                <#if realm.rememberMe && !usernameHidden??>
                    <div class="hud-options">
                        <label>
                            <input tabindex="5" id="rememberMe" name="rememberMe" type="checkbox"<#if login.rememberMe??> checked</#if>>${msg("rememberMe")}
                        </label>
                    </div>
                </#if>

                <div id="kc-form-buttons" class="hud-actions">
                    <input type="hidden" id="id-hidden-input" name="credentialId" <#if auth.selectedCredential?has_content>value="${auth.selectedCredential}"</#if>/>
                    <input tabindex="7" class="hud-btn hud-btn-primary" name="login" id="kc-login" type="submit" value="ENTER"/>
                </div>
            </form>
        </#if>
        <@passkeys.conditionalUIData />
        <script type="module" src="${url.resourcesPath}/js/passwordVisibility.js"></script>
    <#elseif section = "info" >
        <#if realm.password && realm.registrationAllowed && !registrationDisabled??>
            <div id="kc-registration-container">
                <div id="kc-registration">
                    <span>${msg("noAccount")} <a tabindex="8" href="${url.registrationUrl}">${msg("doRegister")}</a></span>
                </div>
            </div>
        </#if>
    </#if>

</@layout.registrationLayout>
```
{{< /details >}}

{{< details title="login/template.ftl" closed="true" >}}
```html
<#import "footer.ftl" as loginFooter>
<#macro registrationLayout bodyClass="" displayInfo=false displayMessage=true displayRequiredFields=false>
<!DOCTYPE html>
<html class="${properties.kcHtmlClass!}" lang="${lang}"<#if realm.internationalizationEnabled> dir="${(locale.rtl)?then('rtl','ltr')}"</#if>>

<head>
    <meta charset="utf-8">
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
    <meta name="robots" content="noindex, nofollow">

    <#if properties.meta?has_content>
        <#list properties.meta?split(' ') as meta>
            <meta name="${meta?split('==')[0]}" content="${meta?split('==')[1]}"/>
        </#list>
    </#if>
    <title>${title!msg("loginTitle",(realm.displayName!''))}</title>
    <link rel="icon" href="data:,">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link href="https://fonts.googleapis.com/css2?family=Exo+2:wght@200;300;400&amp;family=Share+Tech+Mono&amp;family=IBM+Plex+Sans+KR:wght@300;400&amp;display=swap" rel="stylesheet">
    <style>
        :root{--bg:#1a2026;--ink:#d9e1e7;--line:#5d6b76;--faint:#46525c;--sub:#93a2ad;--accent:#4cc3e6;--err:#ff7a6b;--ok:#a9e36b;--warn:#ffb454}
        *{box-sizing:border-box}
        html.hud-html,html.hud-html body{margin:0;background:var(--bg)}
        body.hud-body{margin:0;min-height:100vh;font-family:'Exo 2','IBM Plex Sans KR',sans-serif;font-weight:300;color:var(--ink);-webkit-text-size-adjust:100%}
        a{color:var(--accent);text-decoration:none}
        a:hover,a:focus-visible{text-decoration:underline}
        .hud-mono{font-family:'Share Tech Mono',monospace}
        .hud-login{position:relative;min-height:100vh;display:flex;align-items:center;justify-content:center;gap:96px;padding:88px 40px}
        .hud-corner{position:absolute;width:28px;height:28px;border:0 solid var(--line)}
        .hud-corner.tl{left:32px;top:32px;border-left-width:1px;border-top-width:1px}
        .hud-corner.tr{right:32px;top:32px;border-right-width:1px;border-top-width:1px}
        .hud-corner.bl{left:32px;bottom:32px;border-left-width:1px;border-bottom-width:1px}
        .hud-corner.br{right:32px;bottom:32px;border-right-width:1px;border-bottom-width:1px}
        .hud-tag{position:absolute;font-family:'Share Tech Mono',monospace;font-size:12px;letter-spacing:3px;color:var(--sub)}
        .hud-tag.tl{left:72px;top:38px}
        .hud-tag.br{right:72px;bottom:38px}
        .hud-reticle{position:relative;width:420px;height:420px;flex:none;display:flex;align-items:center;justify-content:center}
        .hud-reticle .ring{position:absolute;inset:0;width:100%;height:100%}
        .hud-reticle .logo{position:relative;width:28.571%;height:auto}
        .hud-panel{width:400px;max-width:100%;display:flex;flex-direction:column;gap:22px}
        .hud-head{display:flex;flex-direction:column;gap:6px}
        .hud-eyebrow{font-family:'Share Tech Mono',monospace;font-size:12px;letter-spacing:3px;color:var(--accent)}
        .hud-title{margin:0;font-size:44px;font-weight:200;letter-spacing:6px;line-height:1.15}
        .hud-rule{height:1px;background:var(--line)}
        .hud-subtitle{margin:0;font-family:'Share Tech Mono',monospace;font-size:13px;font-weight:400;letter-spacing:2px;color:var(--sub);text-transform:uppercase}
        .hud-subtitle:empty{display:none}
        .hud-body-area{display:flex;flex-direction:column;gap:22px}
        .hud-panel .hud-msg{margin:0;font-family:'Share Tech Mono',monospace;font-size:13px;letter-spacing:1.5px;line-height:1.5;color:var(--accent);border-left:2px solid currentColor;padding:2px 0 2px 10px;overflow-wrap:anywhere}
        .hud-panel .hud-msg-error,.hud-panel .hud-msg.error{color:var(--err)}
        .hud-panel .hud-msg-success{color:var(--ok)}
        .hud-panel .hud-msg-warning{color:var(--warn)}
        .hud-panel .hud-msg-info{color:var(--accent)}
        .hud-alert{display:contents}
        .hud-panel .hud-msg a{text-decoration:underline}
        .hud-btn,button.hud-btn,input.hud-btn,a.hud-btn{display:flex;align-items:center;justify-content:center;gap:12px;min-height:46px;padding:0 32px;border:1px solid var(--ink);background:transparent;color:var(--ink);font:400 14px 'Exo 2','IBM Plex Sans KR',sans-serif;letter-spacing:4px;cursor:pointer;text-decoration:none;border-radius:0;-webkit-appearance:none;appearance:none}
        .hud-btn:hover,.hud-btn:focus-visible{border-color:var(--accent);color:var(--accent);outline:none;text-decoration:none}
        .hud-btn-primary,input.hud-btn-primary,button.hud-btn-primary{background:var(--ink);color:var(--bg)}
        .hud-btn-primary:hover,.hud-btn-primary:focus-visible{background:var(--accent);border-color:var(--accent);color:var(--bg)}
        .hud-btn-block{width:100%}
        .hud-btn-lg{min-height:46px}
        .hud-social,.hud-panel ul.hud-social{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:12px}
        .hud-social-btn{height:52px;font-size:15px;letter-spacing:3px;padding:0 16px;width:100%}
        .hud-social-btn svg{flex:none}
        .hud-social-btn.disabled,.hud-social-btn[aria-disabled=true]{opacity:.5;pointer-events:none}
        .hud-field,.hud-form-group{display:flex;flex-direction:column;gap:4px;margin:0}
        .hud-form-group+.hud-form-group{margin-top:18px}
        .hud-field label,label.hud-label,.hud-label{font-family:'Share Tech Mono',monospace;font-size:12px;letter-spacing:2px;color:var(--sub);text-transform:uppercase}
        .hud-panel input:not([type=submit]):not([type=button]):not([type=checkbox]):not([type=radio]):not([type=hidden]),.hud-panel select,.hud-panel textarea{width:100%;height:40px;border:0;border-bottom:1px solid var(--line);border-radius:0;background:transparent;font:300 17px 'Exo 2','IBM Plex Sans KR',sans-serif;color:var(--ink);padding:0;outline:none}
        .hud-panel textarea{height:auto;min-height:80px;border:1px solid var(--line);padding:6px}
        .hud-panel select option{background:var(--bg)}
        .hud-panel input:focus,.hud-panel select:focus,.hud-panel textarea:focus{border-bottom-color:var(--accent)}
        .hud-panel input[aria-invalid=true]{border-bottom-color:var(--err)}
        .hud-panel input:-webkit-autofill{-webkit-text-fill-color:var(--ink);-webkit-box-shadow:0 0 0 40px var(--bg) inset;caret-color:var(--ink)}
        .hud-panel input[type=checkbox],.hud-panel input[type=radio]{accent-color:var(--accent);margin-right:8px}
        .hud-input-group{display:flex;align-items:flex-end;gap:8px}
        .hud-input-group input{flex:1;min-width:0}
        .hud-eye-btn{flex:none;height:40px;border:0;border-bottom:1px solid var(--line);background:transparent;color:var(--sub);cursor:pointer;font:12px 'Share Tech Mono',monospace;letter-spacing:2px;padding:0 4px}
        .hud-eye-btn:hover{color:var(--accent)}
        .hud-eye::before{content:"SHOW"}
        .hud-eye-hide::before{content:"HIDE"}
        .hud-actions{display:flex;justify-content:flex-end;align-items:center;margin-top:4px}
        .hud-options{display:flex;justify-content:space-between;align-items:center;font-family:'Share Tech Mono',monospace;font-size:12px;letter-spacing:2px;color:var(--sub)}
        .hud-settings,.hud-form-options-wrapper{display:flex;justify-content:space-between;gap:12px;font-size:13px;color:var(--sub)}
        .hud-panel p,.hud-panel .instruction{margin:0 0 12px;font-size:15px;line-height:1.6;color:var(--ink)}
        .hud-panel hr{border:0;height:1px;background:var(--faint);margin:0}
        .hud-panel ul,.hud-panel ol{padding-left:20px;margin:0 0 12px}
        .hud-panel table{width:100%;border-collapse:collapse;font-size:14px}
        .hud-panel td,.hud-panel th{border-bottom:1px solid var(--faint);padding:6px 4px;text-align:left}
        .hud-panel code,.hud-panel pre{font-family:'Share Tech Mono',monospace;color:var(--accent);white-space:pre-wrap;overflow-wrap:anywhere}
        .hud-panel form{margin:0}
        .hud-form-buttons,#kc-form-buttons{margin-top:22px}
        .hud-panel #kc-info{margin-top:4px}
        .hud-panel #kc-info-wrapper,.hud-panel #kc-registration{font-size:14px;color:var(--sub)}
        #kc-attempted-username{font-family:'Share Tech Mono',monospace;letter-spacing:2px;color:var(--ink)}
        #kc-username{display:flex;align-items:center;gap:12px;margin:0}
        #reset-login{font-family:'Share Tech Mono',monospace;font-size:12px;letter-spacing:2px}
        .hud-locale{position:absolute;right:72px;top:34px;z-index:2}
        .hud-locale-main{position:relative}
        #kc-current-locale-link{background:transparent;border:0;color:var(--sub);font:12px 'Share Tech Mono',monospace;letter-spacing:3px;cursor:pointer;text-transform:uppercase}
        #kc-current-locale-link:hover{color:var(--accent)}
        .hud-locale-list{display:none;position:absolute;right:0;top:100%;margin:4px 0 0;padding:6px 0;list-style:none;background:var(--bg);border:1px solid var(--line);min-width:120px}
        #kc-current-locale-link[aria-expanded=true]+.hud-locale-list{display:block}
        .hud-locale-item{display:block;padding:6px 14px;font-size:14px;color:var(--ink)}
        .hud-sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
        .hud-panel .pf-c-tile,.hud-panel .select-auth-box-parent{border:1px solid var(--line);padding:10px 12px;margin-bottom:10px}
        @media (max-width:960px){
            .hud-login{flex-direction:column;gap:28px;padding:76px 24px 72px}
            .hud-reticle{width:min(240px,62vw);height:min(240px,62vw)}
            .hud-panel{width:100%;max-width:400px}
            .hud-title{font-size:34px;letter-spacing:4px}
            .hud-corner.tl,.hud-corner.bl{left:12px}
            .hud-corner.tr,.hud-corner.br{right:12px}
            .hud-corner.tl,.hud-corner.tr{top:12px}
            .hud-corner.bl,.hud-corner.br{bottom:12px}
            .hud-tag{font-size:10px;letter-spacing:2px}
            .hud-tag.tl{left:48px;top:18px}
            .hud-tag.br{right:48px;bottom:18px}
            .hud-locale{right:48px;top:14px}
        }
        @media (max-width:400px){
            .hud-login{padding-left:20px;padding-right:20px}
            .hud-title{font-size:28px;letter-spacing:3px}
            .hud-reticle{width:min(200px,56vw);height:min(200px,56vw)}
        }
    </style>
    <script type="importmap">
        {
            "imports": {
                "rfc4648": "${url.resourcesCommonPath}/vendor/rfc4648/rfc4648.js"
            }
        }
    </script>
    <script src="${url.resourcesPath}/js/menu-button-links.js" type="module"></script>
    <#if scripts??>
        <#list scripts as script>
            <script src="${script}" type="text/javascript"></script>
        </#list>
    </#if>
    <script type="module">
        import { startSessionPolling } from "${url.resourcesPath}/js/authChecker.js";

        startSessionPolling(
            "${url.ssoLoginInOtherTabsUrl?js_string?no_esc}"
        );
    </script>
    <script type="module">
        document.addEventListener("click", (event) => {
            const link = event.target.closest("a[data-once-link]");

            if (!link) {
                return;
            }

            if (link.getAttribute("aria-disabled") === "true") {
                event.preventDefault();
                return;
            }

            const { disabledClass } = link.dataset;

            if (disabledClass) {
                link.classList.add(...disabledClass.trim().split(/\s+/));
            }

            link.setAttribute("role", "link");
            link.setAttribute("aria-disabled", "true");
        });
    </script>
    <#if authenticationSession??>
        <script type="module">
            import { checkAuthSession } from "${url.resourcesPath}/js/authChecker.js";

            <#-- 26.3.3 passes the hash as a string, 26.7 as a number -->
            <#assign hudHash = authenticationSession.authSessionIdHash>
            checkAuthSession(
                <#if hudHash?is_string>"${hudHash?js_string?no_esc}"<#else>${hudHash?c}</#if>
            );
        </script>
    </#if>
</head>

<body class="hud-body ${properties.kcBodyClass!}" data-page-id="login-${pageId}">
<div class="${properties.kcLoginClass!}">
    <span class="hud-corner tl" aria-hidden="true"></span>
    <span class="hud-corner tr" aria-hidden="true"></span>
    <span class="hud-corner bl" aria-hidden="true"></span>
    <span class="hud-corner br" aria-hidden="true"></span>
    <span class="hud-tag tl" aria-hidden="true">HUB-01 / MAKGOL / AUTH</span>
    <span class="hud-tag br" aria-hidden="true">SIGNAL &middot; NOMINAL</span>

    <#if realm.internationalizationEnabled && locale.supported?size gt 1>
        <div class="${properties.kcLocaleMainClass!}" id="kc-locale">
            <div id="kc-locale-wrapper" class="${properties.kcLocaleWrapperClass!}">
                <div id="kc-locale-dropdown" class="menu-button-links ${properties.kcLocaleDropDownClass!}">
                    <button tabindex="1" id="kc-current-locale-link" aria-label="${msg("languages")}" aria-haspopup="true" aria-expanded="false" aria-controls="language-switch1">${locale.current}</button>
                    <ul role="menu" tabindex="-1" aria-labelledby="kc-current-locale-link" aria-activedescendant="" id="language-switch1" class="${properties.kcLocaleListClass!}">
                        <#assign i = 1>
                        <#list locale.supported as l>
                            <li class="${properties.kcLocaleListItemClass!}" role="none">
                                <a role="menuitem" id="language-${i}" class="${properties.kcLocaleItemClass!}" href="${l.url}">${l.label}</a>
                            </li>
                            <#assign i++>
                        </#list>
                    </ul>
                </div>
            </div>
        </div>
    </#if>

    <div class="hud-reticle" aria-hidden="true">
        <svg class="ring" viewBox="0 0 420 420" fill="none" aria-hidden="true">
            <circle cx="210" cy="210" r="200" stroke="#46525c" stroke-width="1"></circle>
            <circle cx="210" cy="210" r="160" stroke="#4cc3e6" stroke-width="1.5" stroke-dasharray="4 10"></circle>
            <circle cx="210" cy="210" r="118" stroke="#46525c" stroke-width="1"></circle>
            <path d="M210 0v30M210 390v30M0 210h30M390 210h30" stroke="#93a2ad" stroke-width="1"></path>
            <path d="M68 68l14 14M352 68l-14 14M68 352l14-14M352 352l-14-14" stroke="#46525c" stroke-width="1"></path>
            <path d="M210 50a160 160 0 0 1 138 80" stroke="#4cc3e6" stroke-width="3"></path>
        </svg>
        <svg class="logo" viewBox="0 0 144 144" role="img" aria-label="makgol.com"><path fill="#d9e1e7" fill-rule="evenodd" clip-rule="evenodd" d="M75 5.71L126.55 35.5A6 6 0 0 1 129.55 40.69L129.55 40.69L129.55 100.25A6 6 0 0 1 126.55 105.45L126.55 105.45L75 135.23A6 6 0 0 1 69 135.23L69 135.23L17.45 105.45A6 6 0 0 1 14.45 100.25L14.45 100.25L14.45 40.690A6 6 0 0 1 17.45 35.5L17.45 35.5L69 5.71A6 6 0 0 1 75 5.71ZM67.53 29.36L68.57 31.46A5.41 5.41 0 1 1 75.43 31.46L76.47 29.36C77.93 32.69 80.31 36.81 89.32 42.01C98.32 47.21 103.08 47.21 106.69 46.81L106.69 46.81L105.39 48.76A5.41 5.41 0 1 1 108.83 54.7L111.16 54.55C109.01 57.48 106.63 61.6 106.63 72C106.63 82.4 109.01 86.52 111.16 89.45L111.16 89.45L108.83 89.3A5.41 5.41 0 1 1 105.39 95.24L106.69 97.19C103.08 96.79 98.32 96.79 89.32 101.99C80.31 107.19 77.93 111.31 76.47 114.64L76.47 114.64L75.43 112.54A5.41 5.41 0 1 1 68.57 112.54L67.53 114.64C66.07 111.31 63.69 107.19 54.68 101.99C45.68 96.79 40.92 96.79 37.31 97.19L37.31 97.19L38.61 95.24A5.41 5.41 0 1 1 35.17 89.3L32.84 89.45C34.99 86.52 37.37 82.4 37.37 72C37.37 61.6 34.99 57.48 32.84 54.55L32.84 54.55L35.17 54.7A5.41 5.41 0 1 1 38.61 48.76L37.31 46.81C40.92 47.21 45.68 47.21 54.68 42.01C63.69 36.81 66.07 32.69 67.53 29.36ZM75.22 53.71L75.22 47.22Q75.22 43.9 78.5 44.47A28.29 28.29 0 0 1 92.59 52.6Q94.73 55.16 91.84 56.82L86.23 60.06Q84.25 61.2 82.62 59.6A16.33 16.33 0 0 0 77.43 56.6Q75.22 55.99 75.22 53.71ZM89.46 65.64L95.07 62.4Q97.95 60.74 99.09 63.86A28.29 28.29 0 0 1 99.09 80.14Q97.95 83.26 95.07 81.6L89.46 78.36Q87.47 77.21 88.05 75A16.33 16.33 0 0 0 88.05 69Q87.47 66.79 89.46 65.64ZM86.23 83.94L91.84 87.18Q94.73 88.84 92.59 91.4A28.29 28.29 0 0 1 78.5 99.53Q75.22 100.1 75.22 96.78L75.22 90.29Q75.22 88.01 77.43 87.4A16.33 16.33 0 0 0 82.62 84.4Q84.25 82.8 86.23 83.94ZM68.78 90.29L68.78 96.78Q68.78 100.1 65.5 99.53A28.29 28.29 0 0 1 51.41 91.4Q49.27 88.84 52.16 87.18L57.77 83.94Q59.75 82.8 61.38 84.4A16.33 16.33 0 0 0 66.57 87.4Q68.78 88.01 68.78 90.29ZM54.54 78.36L48.93 81.6Q46.05 83.26 44.91 80.14A28.29 28.29 0 0 1 44.91 63.86Q46.05 60.74 48.93 62.4L54.54 65.64Q56.53 66.79 55.95 69A16.33 16.33 0 0 0 55.95 75Q56.53 77.21 54.54 78.36ZM57.77 60.06L52.16 56.82Q49.27 55.16 51.41 52.6A28.29 28.29 0 0 1 65.5 44.47Q68.78 43.9 68.78 47.22L68.78 53.71Q68.78 55.99 66.57 56.6A16.33 16.33 0 0 0 61.38 59.6Q59.75 61.2 57.77 60.06ZM68.67 72a3.33 3.33 0 1 0 6.66 0a3.33 3.33 0 1 0 -6.66 0Z"></path></svg>
    </div>

    <main class="hud-panel ${properties.kcFormCardClass!}">
        <header class="hud-head ${properties.kcFormHeaderClass!}">
            <span class="hud-eyebrow">IDENTITY REQUIRED</span>
            <#assign hudHeader><#nested "header"></#assign>
            <h1 class="hud-title" id="kc-page-title-brand">MAKGOL SPACE</h1>
            <div class="hud-rule"></div>
            <#if !(auth?has_content && auth.showUsername() && !auth.showResetCredentials())>
                <#if displayRequiredFields>
                    <span class="hud-label"><span class="required">*</span> ${msg("requiredFields")}</span>
                </#if>
                <#if hudHeader?markup_string?trim?has_content><h2 class="hud-subtitle" id="kc-page-title">${hudHeader}</h2></#if>
            <#else>
                <#nested "show-username">
                <div id="kc-username" class="${properties.kcFormGroupClass!}">
                    <label id="kc-attempted-username">${auth.attemptedUsername}</label>
                    <a id="reset-login" href="${url.loginRestartFlowUrl}" aria-label="${msg("restartLoginTooltip")}">&#8634; ${msg("restartLoginTooltip")}</a>
                </div>
            </#if>
        </header>
        <div id="kc-content" class="hud-body-area">
          <div id="kc-content-wrapper" class="hud-body-area">

          <#-- App-initiated actions should not see warning messages about the need to complete the action -->
          <#-- during login.                                                                               -->
          <#if displayMessage && message?has_content && (message.type != 'warning' || !isAppInitiatedAction??)>
              <div class="${properties.kcAlertClass!} alert-${message.type}">
                  <p class="hud-msg hud-msg-${message.type}" role="alert" aria-live="polite"><span class="hud-sr-only">${message.type}: </span>${kcSanitize(message.summary)?no_esc}</p>
              </div>
          </#if>

          <#nested "form">

          <#if auth?has_content && auth.showTryAnotherWayLink()>
              <form id="kc-select-try-another-way-form" action="${url.loginAction}" method="post">
                  <div class="${properties.kcFormGroupClass!}">
                      <input type="hidden" name="tryAnotherWay" value="on"/>
                      <a href="#" id="try-another-way"
                         onclick="document.forms['kc-select-try-another-way-form'].requestSubmit();return false;">${msg("doTryAnotherWay")}</a>
                  </div>
              </form>
          </#if>

          <#if switchOrganizationEnabled?? && switchOrganizationEnabled>
              <form id="kc-switch-organization-form" action="${url.loginAction}" method="post">
                  <div class="${properties.kcFormGroupClass!}">
                      <input type="hidden" name="switchOrganization" value="true"/>
                      <a href="#" id="switch-organization"
                         onclick="document.forms['kc-switch-organization-form'].requestSubmit();return false;">${msg("doSwitchOrganization")}</a>
                  </div>
              </form>
          </#if>

          <#nested "socialProviders">

          <#if displayInfo>
              <div id="kc-info" class="${properties.kcSignUpClass!}">
                  <div id="kc-info-wrapper" class="${properties.kcInfoAreaWrapperClass!}">
                      <#nested "info">
                  </div>
              </div>
          </#if>
          </div>
        </div>

        <@loginFooter.content/>
    </main>
</div>
</body>
</html>
</#macro>
```
{{< /details >}}

## 남은 것

- 로그인 화면은 Google Fonts에서 Exo 2, Share Tech Mono, IBM Plex Sans KR을 받아 옵니다. 로그인 페이지가 외부에 요청을 보내는 게 싫다면 글꼴 파일을 테마에 포함시켜야 합니다.
- 동의 화면은 아직 Testing 상태입니다. Testing에서는 Google이 refresh token을 7일 뒤 만료시킵니다. 동의 화면이 주기적으로 다시 뜨면 In production으로 게시할 생각입니다. `openid email profile`만 쓰니 심사는 필요 없지만, 홈페이지와 개인정보처리방침 URL을 채워야 게시 버튼이 활성화됩니다.
- 사이버펑크 컷 패널도 HUD와 같은 방식으로 옮길 수 있습니다. 컷 코너는 `clip-path`, 글리치는 `text-shadow` 두 겹이라 템플릿 CSS만 바꾸면 됩니다.
