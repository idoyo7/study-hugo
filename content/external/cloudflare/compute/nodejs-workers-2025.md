---
title: "Node.js API를 갖춘 Cloudflare Workers 런타임"
description: "Cloudflare Workers는 서버를 전제로 만든 Node.js 코드를 어떻게 실행할까요? 기존 네트워크 기능과 새 가상 파일 시스템을 활용해 API를 런타임에 구현하고, 호환성 날짜와 플래그로 기존 코드를 보호합니다."
date: 2026-11-16
weight: 11
---

# Node.js API를 갖춘 Cloudflare Workers 런타임 (2025-09)

{{< callout type="info" >}}
**원문 정보**
- 원문: [A year of improving Node.js compatibility in Cloudflare Workers](https://blog.cloudflare.com/nodejs-workers-2025)
- 매체 · 게시일: The Cloudflare Blog · 2025-09-25
- 저자: James M Snell
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## Express의 요청을 받는 Workers 런타임 {#networking-apis}

Workers에서 Express나 Koa를 쓰고 싶다는 요청은 꾸준했습니다. 걸림돌은 이 프레임워크들이 깊이 의존하는 Node.js API였습니다. Cloudflare는 지난 1년간 자주 쓰이거나 요청이 많았던 API를 구현했고, 이제 Express와 Koa도 Workers에서 실행됩니다. 동작하는 인기 npm 모듈은 수백 개, 어쩌면 수천 개에 이릅니다.

목표는 기존 코드를 넣으면 그대로 동작하는 환경입니다. 예전에는 Wrangler 같은 도구가 배포할 때 polyfill과 shim을 삽입하는 방식에 크게 의존했습니다. 이번 API들은 TypeScript와 C++로 Workers 런타임 안에 구현했으며, 추가 의존성 없이 API를 기본 제공하는 방향으로 옮겨 가고 있습니다. Cloudflare는 성능 향상과 메모리 사용량 감소를 이점으로 들지만, 글에 비교 실측치는 제시하지 않았습니다.

네트워킹 구현의 출발점은 Workers에 이미 있는 기능입니다. Workers는 커널 수준의 원시 소켓에 직접 접근할 수 없으므로, 관리형 Sockets API와 Fetch API를 바탕으로 Node.js API를 구현했습니다. `node:http`와 `node:https`의 클라이언트는 Fetch API로 요청을 보내고, HTTP 서버는 Workers의 기존 요청 처리 기능을 사용합니다.

여기서 `cloudflare:node`의 `httpServerHandler()`가 Node.js HTTP 서버를 Workers의 fetch 이벤트에 연결합니다. `http.createServer()`로 만든 서버가 들어오는 요청을 처리하게 해 주는 함수입니다. Express와 Koa를 실행할 수 있게 된 배경도 이 HTTP 지원에 있으며, Fastify 지원은 앞으로의 과제로 남았습니다.

TCP·TLS 연결을 제공하는 `node:net`과 `node:tls`도 Workers Sockets API를 사용합니다. 지원 범위에는 경계가 있습니다. 게시 시점에는 `net.createServer()`로 TCP 서버를 만들 수 없습니다. DNS 질의는 별도 서버 설정 없이 처리하도록 했습니다. `node:dns`가 Cloudflare의 DNS-over-HTTPS 서비스인 1.1.1.1에 하위 요청을 보내는 방식입니다.

## 전 세계에서 임시 파일 공간을 쓴다 {#virtual-file-system}

설정 파일을 읽거나 임시 데이터를 파일에 쓰는 애플리케이션과 모듈은 많습니다. 하지만 Worker는 한 서버에 고정되지 않습니다. 원문이 표현한 실행 리전은 “Region:Earth”입니다. 요청은 Cloudflare의 전 세계 네트워크에 있는 수천 대의 서버 중 어디에서든 실행될 수 있습니다.

이 환경에서 전통적인 파일 시스템을 공유하려면 물리 자원에 접근하는 작업을 조정하고 동기화해야 합니다. 교착 상태 같은 위험도 따릅니다. Cloudflare는 `node:fs`를 지원하기 위해 Workers 안에 메모리 기반 가상 파일 시스템을 새로 만들었습니다. 파일 읽기·쓰기뿐 아니라 디렉터리 생성·삭제, 파일 디스크립터, 심볼릭 링크, 스트림도 지원합니다.

파일을 누가 공유하는지는 실행 환경에 따라 다릅니다. 상태를 유지하지 않는 Worker에서는 한 요청이 만든 파일을 다른 요청에서 읽을 수 없습니다. Durable Object에서는 여러 사용자의 여러 요청이 같은 임시 파일 공간을 사용할 수 있습니다. 공유 범위는 넓어져도 영속성까지 생기지는 않습니다. 재시작이나 배포 후에는 파일이 사라지므로 Durable Object Storage를 대신할 수 없습니다.

R2나 Durable Objects 같은 저장소와 연결하는 영속 저장 기능은 검토 중입니다. 그렇다고 자체 구현까지 기다려야 하는 것은 아닙니다. Durable Objects와 JavaScript RPC를 조합하면 sqlite 저장소를 바탕으로 범용 영속 파일 시스템 추상화를 만드는 것도 가능합니다.

## 프로세스 API를 Worker 환경에 맞춘다 {#process-and-environment}

많은 Node.js 패키지는 `process`가 당연히 존재한다고 가정합니다. Workers에는 프로세스 ID나 사용자·그룹 ID에 대응하는 개념이 없지만, 환경 변수나 로그처럼 그대로 쓸 만한 기능도 있습니다. `node:process`는 이 차이를 Workers의 실행 방식에 맞춰 구현했습니다.

`nodejs_compat`를 켜면 `process` 전역 객체를 쓰거나 모듈을 직접 가져올 수 있습니다. 플래그가 없으면 전역 객체는 `undefined`이고, 모듈을 가져오려는 시도는 오류를 냅니다.

환경 변수 접근은 더 익숙해졌습니다. 이전에는 Worker 함수에 전달된 `env` 인자로 읽어야 했지만, `process.env`에서는 Worker 최상위 범위에서도 읽을 수 있습니다. 값은 Node.js처럼 모두 문자열입니다. 접근 범위가 넓어진 만큼 서드파티 라이브러리도 환경 변수를 읽을 수 있으며, Cloudflare는 비밀값을 다루는 대안으로 Cloudflare Secrets Store를 제시합니다.

읽는 방법은 늘렸지만, 수정한 값까지 서로 전달하지는 않습니다. `process.env`는 Worker 실행 시작 시 채워지고 동적으로 갱신되지 않습니다. 이후 값을 바꿔도 Worker 함수의 `env`에는 반영되지 않으며, `env` 쪽의 변경도 `process.env`로 전달되지 않습니다. Node.js용 라이브러리가 나머지 Worker 코드에서 사용하는 환경을 뜻하지 않게 바꾸는 위험을 줄이려는 선택입니다.

Node.js 호환성을 켜지 않아도 쓸 수 있는 접근 방법도 추가했습니다. `cloudflare:workers`에서 `env`와 `waitUntil`을 직접 가져오면, 바인딩이나 백그라운드 작업을 쓰려고 여러 함수에 `env`와 `ctx`를 계속 전달하지 않아도 됩니다.

표준 스트림은 실제 프로세스의 입출력에 연결되지 않습니다. `process.stdout`과 `process.stderr`에 쓴 내용은 `console.log`처럼 Workers Logs에 기록됩니다. 이 스트림들은 가상 파일 시스템에도 연결되어 있어 `node:fs`의 표준 파일 디스크립터로 출력할 수 있습니다.

익숙한 API 이름 아래에서도 실행 범위는 확인해야 합니다. `process.nextTick()`은 Promise와 같은 microtask 큐를 사용해 `queueMicrotask()`와 동일하게 동작합니다. 작업 디렉터리는 `/bundle`에서 시작하며, 한 요청이 바꿔도 다른 요청의 작업 디렉터리에는 영향을 주지 않습니다. `process.exit()`가 끝내는 대상 역시 현재 요청입니다. 전체 프로세스를 종료하는 Node.js와 달리, Workers에서는 해당 요청의 실행을 멈추고 클라이언트에 오류 응답을 반환합니다.

## Node.js와 코드를 공유하는 ncrypto {#crypto-and-standard-library}

암호화는 Node.js의 구현을 복사하는 방식으로 해결하지 않았습니다. Cloudflare는 Node.js 프로젝트 안에서 암호화의 중심 기능을 별도 의존성 프로젝트인 `ncrypto`로 추출하는 작업에 참여했습니다. Workers와 Bun은 이 코드를 사용해 Node.js 호환 기능을 구현합니다. 같은 기능을 각자 흉내 내는 대신 Node.js가 실행하는 코드를 함께 사용하는 방식입니다.

이 구현으로 `node:crypto`의 해시, HMAC, 대칭·비대칭 암호화, 전자서명, 키 생성·관리, 난수, 키 유도, 인증서 처리 등 주요 기능을 지원합니다. 코드 공유가 모든 동작의 일치까지 보장하지는 않습니다. Workers는 BoringSSL, Node.js는 OpenSSL을 사용하므로 일부 차이는 남습니다.

Cloudflare의 Node.js 기여는 이 작업 밖에서도 이어집니다. 런타임 간 호환성, 주요 버그 수정, 성능 개선에 집중하고 있으며, URLPattern API 구현과 암호화 연산 개선도 기여 사례입니다. Workers 쪽에서도 추가 API 구현과 기존 기능의 성능·호환성 개선을 계속하고 있습니다.

## 기존 기능을 확장한 표준 라이브러리 {#standard-library}

이미 Workers에 있던 기능에 Node.js API를 연결하면서 지원 범위가 늘어난 경우도 있습니다. `node:zlib`가 그 예입니다. 기존 Web Platform Compression API가 제공하던 gzip·deflate에 Brotli 지원과 Node.js 개발자에게 익숙한 압축 API를 더했습니다.

`node:timers`는 웹 표준 타이머와 비슷하지만, 생성한 타이머를 관리하는 `Timeout` 객체를 반환한다는 차이가 있습니다. Workers에도 이 클래스를 구현해 타이머를 취소하거나 다시 실행할 수 있게 했습니다. `node:console`은 새 로깅 체계를 만들지 않고 기존 `globalThis.console`을 얇게 감쌉니다.

## 새 API가 생겨도 계속 실행되는 Worker {#compatibility-controls}

소개된 호환성 기능은 원문 게시 시점에 모두 제공되고 있습니다. 사용을 시작하는 권장 방법은 `wrangler.toml`이나 `wrangler.jsonc`, Cloudflare 대시보드 또는 API에서 `nodejs_compat`를 켜는 것입니다. 최신 기능을 쓰려면 호환성 날짜도 갱신해야 합니다. 추가 기능을 활성화해 두는 데 성능상 불이익은 없습니다.

API를 추가하는 일도 기존 코드를 깨뜨릴 수 있습니다. 일부 패키지가 모듈이나 API의 존재 여부를 검사해 실행 경로를 고르기 때문입니다. Cloudflare가 처음에는 하나의 플래그로 기능을 배포하다가 개별 활성화·비활성화 플래그를 나눈 이유입니다. 예를 들어 `nodejs_compat`를 켠 상태에서도 `no_nodejs_zlib`로 `node:zlib`만 끌 수 있습니다.

API가 존재하는 것과 모든 기능을 실행할 수 있는 것은 별개입니다. Workers에서 구현할 수 없는 기능도 API 자체를 없애지는 않고, 호출할 때 명확한 오류를 내도록 했습니다. 존재 여부를 검사하는 패키지가 깨지는 일을 피하면서, 실제 호출이 조용히 실패하지 않게 한 선택입니다.

지원이 끝난 API를 없애는 일에는 또 다른 제약이 있습니다. Node.js는 LTS 일정에 따라 API를 제거할 수 있지만, Workers는 호환성 날짜가 그대로인 배포를 계속 같은 방식으로 실행해야 합니다. 그래서 Node.js에서 지원이 끝났다는 이유만으로 API를 제거하지 않습니다.

대신 `remove_nodejs_compat_eol`과 버전별 플래그를 호환성 날짜에 연결해 제거를 선택할 수 있게 했습니다. 비 LTS 버전의 API 제거는 다음 LTS 버전의 지원 종료 처리와 묶습니다. 이전 API를 계속 써야 한다면 `add_nodejs_compat_eol_v24` 같은 역방향 플래그로 유지할 수도 있습니다.

{{% details title="호환성 설정과 지원 범위" closed="true" %}}
| 항목 | 값 |
|---|---|
| 소개된 표준 라이브러리 모듈 | `node:console`, `node:crypto`, `node:dns`, `node:fs`, `node:http`, `node:https`, `node:net`, `node:process`, `node:timers`, `node:tls`, `node:zlib` |
| 전체 호환성 활성화 | `compatibility_flags`에 `nodejs_compat` 설정 |
| 전체 활성화 예시의 호환성 날짜 | `2025-09-21`; 최신 기능을 사용하려면 날짜 갱신 필요 |
| Console 개별 제어 | `enable_nodejs_console_module` / `disable_nodejs_console_module` |
| 파일 시스템 개별 제어 | `enable_nodejs_fs_module` / `disable_nodejs_fs_module` |
| HTTP 클라이언트 개별 제어 | `enable_nodejs_http_modules` / `disable_nodejs_http_modules` |
| HTTP 서버 개별 제어 | `enable_nodejs_http_server_modules` / `disable_nodejs_http_server_modules` |
| OS 모듈 개별 제어 | `enable_nodejs_os_module` / `disable_nodejs_os_module` |
| Process 구현 활성화 | `enable_nodejs_process_v2`; 원문 표에 비활성화 플래그 미기재 |
| Zlib 개별 제어 | `nodejs_zlib` / `no_nodejs_zlib` |
| 환경 변수 채우기 제어 | `nodejs_compat_populate_process_env` / `nodejs_compat_do_not_populate_process_env` |
| 초기 가상 작업 디렉터리 | `/bundle`; 요청마다 독립적인 작업 디렉터리 상태 |
| 표준 파일 디스크립터 | stdin `0`, stdout `1`, stderr `2` |
| 지원 종료 API 제거 | `remove_nodejs_compat_eol`; 현재 호환성 날짜까지 지원 종료 대상인 API 제거 |
| 버전별 제거 플래그의 자동 활성화 조건 | 상위 제거 플래그 사용 시, 원문 기준 `remove_nodejs_compat_eol_v22`는 호환성 날짜가 `2027-04-30` 이후, `remove_nodejs_compat_eol_v23`·`remove_nodejs_compat_eol_v24`는 `2028-04-30` 이후 |
| 비 LTS API의 제거 처리 | 다음 LTS 버전의 지원 종료 처리와 묶음 |
| 이전 API 유지 예시 | `add_nodejs_compat_eol_v24` |
| Node.js 프로젝트 기여 인력 | Workers 런타임 팀원 5명과 여름 인턴 1명; 팀원 중 Technical Steering Committee 소속 2명 |
{{% /details %}}
