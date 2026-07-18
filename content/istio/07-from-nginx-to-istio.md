---
title: "nginx에서 Istio로"
weight: 7
---

# 07 · nginx에서 Istio로 — rewrite·헤더·인가는 어디로 갔나

{{< callout type="info" >}}
**한눈에**
- nginx가 **한 파일에 절차적**으로 하던 걸, Istio는 **관심사별 CRD에 선언적**으로 나눈다.
- rewrite·헤더·CORS·타임아웃은 **VirtualService**로, TLS·수신 포트는 **Gateway**로 모인다.
- 인가는 성격별로 갈린다: IP/워크로드는 **AuthorizationPolicy**, JWT는 **RequestAuthentication**+AuthorizationPolicy, `auth_request`류 외부 인가는 **ext_authz(CUSTOM)**.
- 표준 CRD로 안 되는 레이트 리밋·저수준 조작은 [08 EnvoyFilter]({{< relref "08-envoyfilter-extension.md" >}})로 넘어간다.
{{< /callout >}}

> **왜 이 이야기.** nginx로 프록시를 운영하던 시절, 라우팅·rewrite·헤더 조작·접근 제어가 전부 `nginx.conf` **한 파일에 절차적으로** 모여 있었다. 메시로 오면서 이것들이 사라진 게 아니라 **여러 개의 선언적 CRD로 흩어졌다.** rewrite는 VirtualService로, `auth_request`는 AuthorizationPolicy·외부 인가로, 헤더 조작은 또 다른 필드로. 이 문서는 "nginx에서 하던 그것"이 Istio에서 어디로 갔는지를 대응표로 정리한다.

> 관련 문서: [03 게이트웨이·TLS]({{< relref "03-gateway-node-isolation.md" >}}) · [04 설정 GitOps]({{< relref "04-config-as-code.md" >}}) · 표준 CRD로 안 되면 → [08 EnvoyFilter]({{< relref "08-envoyfilter-extension.md" >}})

## 빠른 참조 — nginx 지시어 → Istio 리소스

| nginx | 하던 일 | Istio 대응 |
|---|---|---|
| `location` / `server_name` | 경로·호스트 라우팅 | **VirtualService** `http.match` + **Gateway** `hosts` |
| `rewrite` / `proxy_pass` 경로 변경 | URL 재작성 | **VirtualService** `http.rewrite` |
| `return 301` / `rewrite ... redirect` | 리다이렉트 | **VirtualService** `http.redirect` |
| `proxy_set_header` / `add_header` | 요청·응답 헤더 조작 | **VirtualService** `http.headers` |
| `allow` / `deny` (IP) | IP 접근 제어 | **AuthorizationPolicy** `ipBlocks` / `remoteIpBlocks` |
| `auth_basic` / JWT 검증 | 인증 | **RequestAuthentication**(JWT) + **AuthorizationPolicy** |
| `auth_request` | 외부 인가 서브요청 | **ext_authz**(AuthorizationPolicy `CUSTOM` + extensionProvider) |
| CORS 헤더 수작업 | CORS | **VirtualService** `http.corsPolicy` |
| `proxy_read_timeout` / `proxy_next_upstream` | 타임아웃·재시도 | **VirtualService** `http.timeout` / `http.retries` |
| `ssl_certificate` | TLS 종료 | **Gateway** `tls`([03]({{< relref "03-gateway-node-isolation.md" >}})) |
| `limit_req` | 레이트 리밋 | EnvoyFilter local/global rate limit → [08]({{< relref "08-envoyfilter-extension.md" >}}) |

핵심 통찰 하나: **nginx는 하나의 파일에 절차적으로, Istio는 관심사별 CRD에 선언적으로.** 강력한 분리지만, "이 동작이 어디서 정의됐나"가 여러 리소스로 흩어지므로 형상 관리(GitOps)가 필수가 된다 → [04]({{< relref "04-config-as-code.md" >}}).

## 라우팅·rewrite·리다이렉트

nginx의 `location`과 `rewrite`가 하던 일은 대부분 **VirtualService** 하나에 모인다.

```yaml
apiVersion: networking.istio.io/v1
kind: VirtualService
metadata: { name: web }
spec:
  hosts: [ "www.example.com" ]
  gateways: [ web-gateway ]      # 03의 그 게이트웨이
  http:
  - match:
    - uri: { prefix: /api/ }     # nginx: location /api/
    rewrite:
      uri: /                     # nginx: rewrite ^/api/(.*) /$1 break;
    route:
    - destination: { host: api-svc, port: { number: 8080 } }
  - match:
    - uri: { exact: /old }
    redirect: { uri: /new, redirectCode: 301 }   # nginx: return 301 /new
```

- `match`는 `uri.{exact,prefix,regex}`, `headers`, `method`, `queryParams`로 nginx의 다양한 `location` 매칭을 대체한다.
- prefix 매칭에 `rewrite.uri`를 쓰면 접두어가 치환된다. `rewrite.authority`로 Host 헤더도 바꾼다(nginx `proxy_set_header Host`).

## 헤더 조작

nginx의 `proxy_set_header`(요청)와 `add_header`(응답)는 VirtualService의 `headers`로 온다.

```yaml
  http:
  - route:
    - destination: { host: api-svc }
    headers:
      request:
        set:    { x-env: prod }         # proxy_set_header x-env prod;
        remove: [ x-debug ]
      response:
        add:    { x-frame-options: DENY }  # add_header X-Frame-Options DENY;
```

`set`은 덮어쓰기, `add`는 append, `remove`는 삭제다. 라우트 단위뿐 아니라 DestinationRule 등 다른 계층에서도 헤더를 만질 수 있다.

## 인가 — nginx의 `allow`/`deny`/`auth_request`가 흩어지는 곳

접근 제어는 Istio에서 **성격별로 리소스가 갈린다.** 이게 nginx에서 넘어올 때 가장 헷갈리는 지점이다.

### IP·워크로드 기반 (allow/deny)

`AuthorizationPolicy`가 L7 ALLOW/DENY를 담당한다. nginx `allow`/`deny`의 대응이다.

```yaml
apiVersion: security.istio.io/v1
kind: AuthorizationPolicy
metadata: { name: api-allow, namespace: prod }
spec:
  selector: { matchLabels: { app: api } }
  action: ALLOW
  rules:
  - from:
    - source: { remoteIpBlocks: [ "10.0.0.0/8" ] }   # nginx: allow 10.0.0.0/8; deny all;
    to:
    - operation: { methods: [ GET, POST ], paths: [ "/api/*" ] }
```

- `from.source`로 **누가**(principals·namespaces·ipBlocks/remoteIpBlocks)를, `to.operation`으로 **무엇을**(paths·methods·hosts)을, `when`으로 조건을 건다.
- IP 기반은 주의점이 있다: 클라이언트 실제 IP를 보려면 `remoteIpBlocks`(X-Forwarded-For 기반)와 게이트웨이의 XFF/externalTrafficPolicy 설정이 맞물려야 한다.

### 인증 — JWT (auth_basic/JWT 검증)

토큰 검증은 **RequestAuthentication**(검증)과 **AuthorizationPolicy**(강제)의 조합이다.

```yaml
apiVersion: security.istio.io/v1
kind: RequestAuthentication
metadata: { name: jwt, namespace: prod }
spec:
  selector: { matchLabels: { app: api } }
  jwtRules:
  - issuer: "https://auth.example.com"
    jwksUri: "https://auth.example.com/.well-known/jwks.json"
---
apiVersion: security.istio.io/v1
kind: AuthorizationPolicy
metadata: { name: require-jwt, namespace: prod }
spec:
  selector: { matchLabels: { app: api } }
  action: ALLOW
  rules:
  - from: [ { source: { requestPrincipals: [ "*" ] } } ]   # 유효한 JWT 필수
```

RequestAuthentication은 "토큰이 있으면 검증"만 하지 **강제하지 않는다**. "토큰 없으면 거부"는 AuthorizationPolicy가 `requestPrincipals`로 요구해야 완성된다. `when: request.auth.claims[...]`로 클레임 기반 인가도 가능하다.

### 외부 인가 — `auth_request`의 진짜 대응 (ext_authz)

nginx `auth_request`처럼 **매 요청을 외부 인가 서비스에 물어보는** 패턴은 Istio의 **external authorization**이다. 메시 설정에 인가 제공자를 등록하고, AuthorizationPolicy의 `action: CUSTOM`으로 그 제공자를 호출한다.

```yaml
# meshConfig.extensionProviders 에 envoyExtAuthzHttp/Grpc 제공자 등록 후
spec:
  action: CUSTOM
  provider: { name: my-ext-authz }
  rules: [ { to: [ { operation: { paths: [ "/secure/*" ] } } ] } ]
```

Envoy의 ext_authz 필터가 요청을 인가 서비스로 보내 allow/deny를 받는다 — 커스텀 인증 로직을 메시 밖 서비스로 빼는, `auth_request`와 정확히 같은 발상이다.

## CORS·타임아웃·재시도

nginx에서 손으로 CORS 헤더를 붙이던 것도 선언적으로 바뀐다.

```yaml
  http:
  - route: [ { destination: { host: api-svc } } ]
    corsPolicy:                       # nginx: add_header Access-Control-Allow-* ...
      allowOrigins: [ { exact: "https://www.example.com" } ]
      allowMethods: [ GET, POST ]
    timeout: 3s                       # proxy_read_timeout
    retries:                          # proxy_next_upstream
      attempts: 3
      perTryTimeout: 1s
      retryOn: "5xx,connect-failure"
```

재시도는 **멱등 요청에만** 거는 게 원칙이다([05]({{< relref "05-incident-intermittent-5xx.md" >}})의 탄력성 항목과 이어진다).

## "어디로 갔나" 요약

| 관심사 | nginx 위치 | Istio 위치 |
|---|---|---|
| 라우팅·rewrite·리다이렉트·헤더·CORS·타임아웃·재시도 | `server`/`location` 블록 | **VirtualService** |
| TLS 종료·수신 포트/호스트 | `server`/`listen`/`ssl_*` | **Gateway** |
| IP·워크로드 접근 제어 | `allow`/`deny` | **AuthorizationPolicy** |
| JWT 인증 | (모듈) | **RequestAuthentication** + AuthorizationPolicy |
| 외부 인가 | `auth_request` | **ext_authz**(AuthorizationPolicy CUSTOM) |
| 레이트 리밋·저수준 필터 | `limit_req` 등 | **EnvoyFilter** → [08]({{< relref "08-envoyfilter-extension.md" >}}) |

## 이 문서에서 가져갈 것

- nginx가 **한 파일에 절차적**으로 하던 것을, Istio는 **관심사별 CRD에 선언적**으로 나눈다. 강력하지만 설정이 흩어지므로 GitOps가 전제가 된다.
- rewrite·헤더·CORS·타임아웃은 **VirtualService** 하나에, TLS·수신은 **Gateway**에 모인다.
- 인가는 성격별로 갈린다: IP/워크로드는 **AuthorizationPolicy**, JWT는 **RequestAuthentication**과의 조합, `auth_request`류 외부 인가는 **ext_authz(CUSTOM)**. 표준 CRD로 안 되는 레이트 리밋·커스텀 조작은 [08]({{< relref "08-envoyfilter-extension.md" >}})로 넘어간다.
