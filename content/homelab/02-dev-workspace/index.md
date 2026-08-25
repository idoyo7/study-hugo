---
title: "02 개발환경 — 브라우저와 아이패드"
weight: 2
---

# 개발환경 — 터미널 하나를 어디서든 같은 자리로 연다

앞 편은 클러스터 쪽 이야기였습니다. 이번엔 그 클러스터 위에서 제가 실제로 코드를 만지는 자리를 다룹니다. 한 문장으로 줄이면 hub 클러스터에 code-server를 pod로 띄워 두고 노트북이든 데스크탑이든 브라우저로 들어가 그 터미널에 앉는 구조입니다. 같은 터미널에 아이패드로도 붙습니다. 이 글도 그 터미널 안에서 쓰고 있습니다.

클러스터 배치와 NAS, 그리고 Keycloak 한 곳으로 로그인을 모으는 원칙은 [hub / edge 구조]({{< relref "../01-hub-edge-architecture/index.md" >}})에 있습니다. 여기서는 그 둘 위에 사람의 작업 자리를 어떻게 마련했는지만 봅니다.

## 전체 그림

{{< flow src="_flow/1-전체-오버뷰.json" />}}

왼쪽이 사용자 기기, 오른쪽이 클러스터입니다. 노트북이든 데스크탑이든 브라우저로 웹 VS Code에 들어가면 편집기와 터미널이 한 화면에 있습니다. 그 요청은 관문에서 Keycloak 인증을 지나 code-server pod에 닿고, 터미널은 tmux 위에서 Claude Code를 띄웁니다. pod는 홈서버 여러 대 중 한 노드에 뜨는데 어느 노드든 상관없습니다. 작업 디렉토리가 NAS에 있으니까요. 아이패드는 관문을 거치지 않고 Anthropic 릴레이를 통해 같은 Claude Code에 붙습니다. 어느 쪽으로 들어와도 같은 pod의 같은 tmux 세션에서 만납니다. 클러스터 안쪽과 아이패드 쪽은 아래에서 하나씩 폅니다.

## 호스팅 구조 — 관문과 pod

{{< flow src="_flow/2-호스팅-구조.json" />}}

왼쪽에서 오른쪽으로 읽으면 됩니다. 브라우저가 공인 도메인으로 들어와 istio gateway에 닿고 앞에 선 oauth2-proxy가 로그인 쿠키를 검사합니다. 쿠키가 없으면 Keycloak으로 보냅니다. 쿠키가 있으면 code-server pod로 넘깁니다. pod의 홈 디렉토리는 노드 디스크가 아니라 NAS에 있습니다.

pod가 어느 노드에 뜨는지는 신경 쓰지 않습니다. 홈서버 여러 대가 노드로 묶여 있고 스케줄러가 고르는 대로 뜹니다. 그래도 되는 건 홈 디렉토리가 스토리지 PVC이기 때문입니다. 관문을 지나면 pod의 터미널이 나오고 그 터미널의 파일은 NAS에 있습니다. 여기까지만 잡으면 됩니다.

| 구성 | 실제 값 |
|------|---------|
| 도메인 | 공인 도메인 하나 — istio gateway가 받아 pod로 넘김 |
| 인증 | oauth2-proxy (OIDC) → Keycloak SSO, 그룹 `code-server-users` |
| code-server | `--auth=none`. 인증은 앞단이 끝냈으니 본체는 믿고 받음 |
| 홈 디렉토리 | 스토리지 PVC — 노드에는 남길 것이 없음 |
| 배치 | hub 클러스터 안 pod — 홈서버 중 한 노드, 상태는 NAS |

pod 안의 컨테이너 이름은 `code-server`이고 istio-proxy 사이드카가 하나 더 붙습니다. 실제로 도는 프로세스는 이렇습니다.

```
code-server --bind-addr 0.0.0.0:8080 --auth=none /home/mont
```

| 항목 | 값 | 어디서 오나 |
|------|-----|-------------|
| 이미지 | `monthouse-workspace-code-server` — base `codercom/code-server:4.106.3` | Deployment |
| `--bind-addr 0.0.0.0:8080` | 고정 | 이미지 `entrypoint.sh` |
| `--auth=none` | 인증 끔 | pod `args` (Dockerfile CMD 기본값과 동일) |
| `/home/mont` | 열 디렉토리 | pod `args` |
| `containerPort` | 8080 | pod spec |
| env `WORKSPACE_USER` | entrypoint가 gosu로 이 유저로 강등 | pod spec |
| `/home/mont` | 스토리지 PVC | volumeMounts |
| `/etc/workspace-init` | ConfigMap — init-script 카탈로그 | volumeMounts |
| resources | requests 100m / 200Mi, limits 12 CPU / 24Gi | pod spec |
| securityContext | `fsGroup: 1000`, `fsGroupChangePolicy: OnRootMismatch` | pod spec |
| lxcfs | `/proc/cpuinfo`·`meminfo` 등 hostPath 마운트 | admission webhook 주입 |

entrypoint는 부팅 때마다 플랫폼이 관리하는 settings.json 키를 사용자 설정에 deep-merge하고 tmux.conf를 배치한 뒤 `gosu`로 code-server를 실행합니다. `~/.config/code-server/config.yaml`에 `auth: password`가 남아 있어도 CLI 플래그 `--auth=none`이 우선이라 무시됩니다.

## 인증을 code-server 밖으로 뺀 이유

code-server 자체에도 비밀번호 인증이 있습니다. 처음엔 그걸 썼습니다. 호스트 한 대에 systemd로 띄우고 설정 파일에 `password: …` 한 줄을 넣은 채 공인 도메인에서 프록시만 걸어둔 형태였습니다. 비밀번호 하나를 브라우저마다 돌려 쓰다 보니 어디서 로그인했는지 알 수 없고 사람을 빼려면 비밀번호를 바꿔야 했습니다.

지금은 code-server가 인증을 하지 않습니다. `auth: none`으로 두고 클러스터 안의 oauth2-proxy가 Keycloak에 로그인을 위임합니다. 콜백 주소는 인증 전용 호스트 하나로 모았습니다. 쿠키를 상위 도메인에 걸어 두어 한 번 로그인하면 `3000-` 같은 포트 접두 서브도메인의 개발 서버에도 그대로 들어갑니다. pod 안에는 인증 관련 설정이 한 줄도 없습니다.

[hub / edge 구조]({{< relref "../01-hub-edge-architecture/index.md" >}})에서 ArgoCD 로그인을 Keycloak으로 모은 것과 같은 원칙입니다. 사람을 넣고 빼는 곳은 한 군데여야 합니다. 개발환경이라고 예외를 두면 그 예외가 제일 먼저 관리에서 빠집니다.

대가도 같습니다. Keycloak이 죽으면 code-server에 못 들어갑니다. 이미 열린 세션은 쿠키가 살아 있는 동안 유지되고 터미널 안에서 돌던 것들은 tmux가 붙들고 있습니다. 로그인 관문이 잠깐 닫히는 것과 작업이 날아가는 것은 다른 일입니다.

## 터미널은 tmux 위에 앉는다

code-server의 통합 터미널은 탭을 닫으면 셸이 죽습니다. 브라우저 탭이 날아가도, 노트북을 덮어도 마찬가지입니다. 그래서 터미널이 열릴 때 바로 셸을 주지 않고 tmux에 붙입니다.

`main`이라는 세션 하나가 pod 안에서 계속 살아 있고 터미널을 열 때마다 그 세션에 묶인 grouped session을 하나 만들어 새 window를 골라 앉힙니다. 터미널을 닫으면 그 window가 빈 bash였을 때만 정리하고 claude나 ssh처럼 뭔가 돌고 있으면 `main`에 남깁니다. 다음에 어느 브라우저에서 들어와도 `prefix+w`로 어제 돌려 둔 것을 그대로 잡을 수 있습니다.

처음엔 "비어 있는 window를 재사용"하는 쪽이었는데, 그러면 새 터미널을 열었을 때 어제의 cwd와 scrollback이 딸린 셸에 떨어지는 일이 잦아서 지금은 무조건 새 window를 만듭니다. 새 터미널은 항상 깨끗한 프롬프트이고 살아남아야 하는 셸은 살아남습니다.

## 아이패드에서 같은 Claude Code에 붙는다

{{< flow src="_flow/3-아이패드-원격-제어.json" />}}

위 줄이 지금까지 설명한 길입니다. 아래 줄이 이 글을 쓰게 된 이유입니다.

터미널에서 `claude`를 띄우고 `/rc`를 치면 그 세션이 Anthropic 릴레이에 등록됩니다. 아이패드의 Claude 앱에서 그 세션을 고르면 pod 안에서 돌고 있는 바로 그 Claude Code가 화면에 뜹니다. 별도의 code-server 로그인도, VPN도 없습니다. 연결은 pod가 밖으로 여는 아웃바운드 HTTPS라 집 쪽에 포트를 하나도 더 열지 않습니다.

이 그림에서 두 길은 결국 한 곳에서 만납니다. 브라우저로 들어간 터미널과 아이패드가 보는 Claude Code는 같은 pod의 같은 tmux window이고 같은 NAS 디렉토리를 봅니다. 아이패드에서 "이 파일 고쳐"라고 한 결과가 NAS에 쓰이고 나중에 노트북 브라우저로 들어가면 그 변경이 그대로 있습니다. 기기가 바뀌어도 작업 자리는 한 곳입니다.

그래서 실제로는 이렇게 씁니다. 책상에서는 브라우저로 code-server를 열어 편집기와 터미널을 같이 씁니다. 자리를 뜰 땐 tmux가 붙들고 있으니 아무것도 정리하지 않습니다. 소파나 밖에서는 아이패드로 같은 Claude Code 세션을 이어서 시킵니다. 돌아와 브라우저를 열면 아이패드에서 한 일이 그 터미널의 scrollback에 남아 있습니다.

## 대가

- 무거운 편집 작업은 아이패드로 못 합니다. 릴레이로 붙는 건 Claude Code 세션이지 편집기가 아니니 아이패드에서 할 수 있는 일은 "시키고 확인하는 것"까지입니다.
- 관문(Keycloak·gateway)과 NAS가 전부 hub에 있어 hub가 통째로 내려가면 새 로그인도 홈 디렉토리도 없습니다. 이 개발환경은 hub의 일부로 두고 그 대가를 받아들였습니다.
- 릴레이 경로는 Anthropic 쪽 서비스에 의존합니다. 이게 막히면 아이패드 길만 닫히고 브라우저 길은 그대로입니다.
