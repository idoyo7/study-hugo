---
title: "에이전트 작업에 맞춰 다시 설계한 Cloudflare Containers"
description: "작업마다 다른 환경이 필요하고 며칠 뒤에도 이어지는 에이전트의 일을 어떻게 지원할까요? Cloudflare는 Durable Object 코드가 실행 환경을 고르게 하고, 시작 경로를 단축하며 파일시스템 스냅샷으로 작업 공간을 보존하도록 Containers를 개편했습니다."
date: 2026-11-16
weight: 1
---

# 에이전트 작업에 맞춰 다시 설계한 Cloudflare Containers (2026-09)

{{< callout type="info" >}}
**원문 정보**
- 원문: [Cloudflare Containers, rebuilt to scale agent sandboxes](https://blog.cloudflare.com/faster-agent-sandboxes)
- 매체 · 게시일: The Cloudflare Blog · 2026-09-30
- 저자: Thomas Gauvin, Rushil Mehra, Gabi Villalonga Simón, Thomas Lefebvre
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 배포 때 고정된 Containers의 실행 환경 {#agent-workspace-requirements}

작은 Node.js 샌드박스와 큰 Python 빌드 환경을 함께 제공하려면, 기존 Cloudflare Containers에서는 애플리케이션과 Durable Object 네임스페이스를 각각 준비해야 했습니다. Worker에는 작업을 알맞은 환경으로 보내는 라우팅 로직도 들어갔습니다. 환경이 늘 때마다 배포도 늘었습니다. 이미지와 컴퓨트 자원을 애플리케이션 배포 때 고정했기 때문입니다.

에이전트는 작업이 생긴 뒤 환경을 만듭니다. 필요한 이미지와 자원, 도구, 초기 파일시스템이 작업마다 다르고, 몇 분 쓰고 끝낼 수도 있지만 요청 사이에 잠들거나 며칠 뒤 복원해야 할 수도 있습니다. 이 결정들은 작업을 처리하는 코드 가까이에 있어야 했습니다. 샌드박스가 준비되는 동안 사용자가 기다린다는 점도 빠뜨릴 수 없습니다.

Cloudflare가 Base44의 앱 개발 작업 공간과 Kilo Code의 클라우드 에이전트 세션에서 확인한 요구입니다. 새 `durable_object` 스케줄링 정책은 환경을 고르는 시점을 배포에서 실행으로 옮깁니다. 이 정책과 작업 공간을 저장할 파일시스템 스냅샷은 공개 베타로 나왔습니다.

## 잠든 Linux 곁에 남는 Durable Object {#durable-object-controller}

이 제어를 맡은 Durable Object는 처음부터 Container마다 연결되어 있었습니다. Container 바로 옆에서 자체 컴퓨트와 스토리지를 사용하며, 환경의 안정적인 식별자와 상태를 유지하고 시작·휴면·중지를 제어했습니다. 새 설계는 이 역할을 더 넓힙니다.

에이전트 루프를 Durable Object에서 실행하고 Container를 작업 공간으로 쓰면 Anthropic이 설명한 “두뇌와 손의 분리” 패턴이 됩니다. Linux 환경이 잠들거나 실패해도 에이전트는 계속 응답할 수 있습니다. Durable Object에서 세션 상태를 유지하고 WebSockets로 사용자와 통신하며 모델을 호출하다가, 셸이나 컴파일러, 개발 서버가 필요할 때 Container를 깨우는 방식입니다. 사용자나 모델을 기다리는 동안에는 Linux 컴퓨트를 중지해 유휴 Linux 컴퓨트 비용을 내지 않아도 됩니다.

에이전트를 Container 안에서 실행하는 구성도 가능합니다. 이때 Durable Object는 바깥에서 실행을 감독하고 사용자에게 진행 상황을 전달합니다. 어느 쪽이든 샌드박스 밖에 상태와 정책을 보관할 자리가 남습니다.

권한 제어도 그 자리에서 맡을 수 있습니다. Durable Object가 사용자가 허용한 서비스·저장소·작업을 기억하고, Container의 Outbound Request Handler를 갱신해 새로 허용된 자격 증명을 주입하거나 정책을 적용하고 활동을 기록하는 식입니다. 작업 환경의 시작과 중지뿐 아니라 그 환경이 무엇을 할 수 있는지도 코드로 다룹니다.

## 별도 배포를 대신하는 이미지 선택 코드 {#runtime-selection-and-rollouts}

새 정책을 사용하려면 설정에 `scheduling_policy: "durable_object"`를 지정하고 Durable Object가 선택할 이미지를 선언합니다. 그 뒤에는 Container를 시작하는 코드가 이미지와 인스턴스 유형을 전달합니다. 예를 들어 Python과 Node.js 중 필요한 이미지를 고르고, 빌드 작업에는 `standard-2`, 그 외에는 `standard-1`을 지정할 수 있습니다. 별도 애플리케이션과 `wrangler deploy`로 나누던 선택이 같은 Durable Object 클래스 안의 `if` 문으로 옮겨 온 것입니다.

이미지 교체 시점도 코드가 정합니다. 이전에는 애플리케이션 전체를 업데이트하면서 실행 중인 인스턴스를 비울 유예 시간과 점진적인 트래픽 분배 비율을 설정하고, API로 새 구성을 적용했습니다. 그 과정에서 어떤 인스턴스를 언제 교체할지는 플랫폼이 결정했습니다. 에이전트가 작업 중이어도 마찬가지였습니다.

새 정책에서는 Container가 코드에 의해 중지될 때까지 처음 선택한 이미지로 계속 실행할 수 있습니다. 다음에 시작할 이미지도 Durable Object 코드가 고릅니다. 별도 롤아웃 설정 없이 작업의 진행 상태에 맞춰 전환 시점을 정할 수 있게 됐습니다.

예를 들어 Durable Object ID를 해시해 새 샌드박스의 5%에만 새 도구 체계를 적용할 수 있습니다. 진행 중인 프로젝트는 기존 이미지에 고정하고, 다음 세션이나 스냅샷을 저장한 뒤에 전환하는 선택도 가능합니다. 롤백할 때는 이후 시작에서 고를 이미지를 바꿉니다. 설정을 다시 밀어 넣거나 실행 중인 인스턴스가 비워지기를 기다리는 절차가 필요하지 않습니다.

## 첫 명령을 앞당긴 Container의 시작 경로 {#faster-container-startup}

Durable Object에 제어를 모으자 Container를 어디서 시작할지도 달라졌습니다. 이전에는 전역 제어 영역이 애플리케이션 설정을 확인하고 가용 자원을 찾아 배치를 조율했습니다. 에이전트의 첫 명령 앞에 배포용 절차가 놓여 있었습니다.

새 경로는 Durable Object가 실행 중인 곳에서 출발합니다. 인프라는 같은 머신의 가용 자원을 먼저 찾고, 부족하면 같은 위치 안으로 탐색 범위를 넓힙니다. 이미지나 스냅샷을 로컬 스토리지에 보유한 호스트도 우선합니다. 이미 있는 파일을 다시 다운로드하며 기다리지 않도록 한 선택입니다.

호스트에 도착한 뒤의 작업도 줄였습니다. 가상 머신을 처음부터 부팅하는 대신, 미리 준비했지만 아직 할당하지 않은 가상 머신을 복원합니다. 네트워크와 파일시스템 설정을 재사용하고 반복 작업을 묶으며, 첫 명령에 필요하지 않은 서비스가 준비되기를 기다리지 않습니다.

ComputeSDK의 독립적인 Burst TTI Benchmark는 샌드박스 100개를 병렬로 시작하고 클라이언트에서 명령을 실행할 수 있는 상태에 이르기까지의 시간을 측정했습니다. 중앙값은 4.049초에서 648밀리초로 줄어 6.2배 빨라졌습니다. 95백분위와 99백분위에서도 각각 6.4배와 5.9배의 개선을 보였습니다.

Cloudflare 자체 예비 버스트 테스트는 별도의 측정입니다. 단일 계정으로 6개 위치에서 Container 100,000개를 5.387초에 시작했습니다. 독립 벤치마크의 개별 샌드박스 시작 시간과 대량 생성 시험의 결과는 구분해서 봐야 합니다.

## 다음 세션과 실험의 출발점이 되는 스냅샷 {#filesystem-snapshots}

스케줄링이 빨라지자 이미지 준비 시간이 더 눈에 띄었습니다. Container를 시작하려면 호스트에 이미지를 내려받아 파일시스템으로 풀어야 합니다. Cloudflare가 도입한 `cloudflare/debian-trixie`는 Debian Trixie Slim과 Node.js 24.20.0 LTS를 담은 시스템 이미지입니다. 직접 관리하는 이미지이므로 요청이 오기 전에 사용 가능한 호스트에 배포하고 준비해 둘 수 있습니다.

에이전트는 Dockerfile 작성, 이미지 빌드와 업로드 없이 이 이미지로 Linux 환경을 시작한 뒤 `exec()`로 저장소를 복제하고 패키지를 설치할 수 있습니다. 그래도 작업 준비는 남습니다. 저장소 복제와 의존성 설치, 도구 설정은 Container 자체를 시작하는 것보다 오래 걸릴 수 있고, 에이전트가 만든 파일도 다음 작업에 필요합니다.

파일시스템 스냅샷은 이 준비와 작업 결과를 보존합니다. 시스템 이미지에서 시작해 `exec()`로 환경을 구성한 뒤 스냅샷을 남기면, 이후 샌드박스는 저장소와 의존성, 도구가 갖춰진 상태에서 출발할 수 있습니다. 코딩 에이전트가 하루의 작업을 마칠 때 저장하고 다음 날 돌아오는 경우라면 빌드 캐시와 설정, 수정한 파일까지 이어서 사용합니다. 작업이 멈추면 컴퓨트를 중지하고, 재개할 때 최신 스냅샷에서 새 Container를 시작하는 방식입니다.

같은 스냅샷을 여러 작업의 출발점으로 삼을 수도 있습니다. 스냅샷은 불변이며 재사용 가능하므로 여러 Container가 같은 상태에서 독립적으로 시작해 각자 변경을 만듭니다. 에이전트 평가인 eval에서는 저장소·의존성·도구·입력 파일을 고정한 채 시스템 프롬프트, skills, 모델, 에이전트 버전을 비교할 수 있습니다. 환경 차이가 평가 결과에 끼어들지 않도록 하고 반복 준비 시간도 줄입니다.

eval과 강화학습에서는 바깥의 제어기가 다시 역할을 합니다. 조정자가 기본 스냅샷에서 여러 시도를 만들면 각 Durable Object가 자기 Container의 실행을 감독하고, Container가 충돌해도 결과를 보존할 수 있습니다. 조정자는 결과를 평가하고 가장 좋은 시도의 스냅샷에서 다시 여러 시도를 시작하는 패턴을 구성할 수 있습니다.

## 유틸리티 모음으로 바뀐 Sandbox SDK 1.0 {#native-api-migration}

처음 Containers를 내놓을 때 Cloudflare는 개발자에게 익숙한 사용 경험을 주려고 `Container` 클래스 뒤에 Durable Object를 감췄습니다. Sandbox SDK도 그 클래스를 기반으로 만들었습니다. 당시 런타임에 없던 명령 실행, 아웃바운드 요청 가로채기, 스냅샷을 사용자 공간에서 구현한 것입니다.

에이전트 작업 공간이 주요 워크로드로 자리 잡으면서 이 추상화의 제약이 드러났습니다. 함께 작업한 거의 모든 팀이 서로 다른 휴면 정책, 자격 증명 처리, eval 추적 방식을 원했습니다. Durable Object를 숨긴 탓에 그 식별자와 상태, 조정 기능을 Container와 함께 사용하기도 어려웠습니다.

이제 해당 기능은 네이티브 API로 제공됩니다. `exec()`는 Workers 런타임에서 직접 실행되며, 아웃바운드 요청 가로채기와 런타임 이미지·인스턴스 선택, 파일시스템 스냅샷은 `ctx.container`에서 사용합니다. 새 `durable_object` 정책과 시작 속도 개선도 `ctx.container`에서만 제공됩니다. 개발자는 이 기능들을 Durable Object의 스토리지, 알람, WebSockets, RPC와 함께 조합합니다.

Sandbox SDK 1.0은 기반 클래스 대신 개발자가 작성한 Durable Object 클래스 안에서 쓰는 유틸리티 모음으로 바뀝니다. 더 높은 수준의 환경을 제공하는 `@cloudflare/computer`는 Dynamic Workers와 Containers에 동기화된 파일시스템을 결합합니다.

기존 `Container`와 레거시 `Sandbox` 클래스의 유지보수 기한은 2026-12-31입니다. 그 뒤에도 기존 배포는 계속 실행되지만 클래스 업데이트는 중단됩니다. Cloudflare는 `ctx.container`로의 이전을 권합니다. 일반적인 마이그레이션은 `Container` 상속을 `DurableObject` 상속으로 바꾸고 `this.ctx.container`를 직접 호출하는 작업입니다.

{{% details title="측정 조건과 세부 수치·설정값" closed="true" %}}
| 항목 | 값 |
|---|---|
| 독립 벤치마크 조건 | ComputeSDK Burst TTI Benchmark, 샌드박스 100개를 병렬 시작하고 클라이언트에서 time-to-interactive 측정 |
| 중앙값 | 이전 4.049초 → 새 정책 648밀리초, 6.2배 빨라짐 |
| 95백분위 | 이전 5.839초 → 새 정책 910밀리초, 6.4배 빨라짐 |
| 99백분위 | 이전 6.717초 → 새 정책 1,129밀리초, 5.9배 빨라짐 |
| Cloudflare 자체 예비 버스트 테스트 | 단일 계정, 6개 위치에서 Container 100,000개를 5.387초에 시작 |
| 스케줄링 설정 | `scheduling_policy: "durable_object"` |
| 작업별 환경 선택 예시 | Python 또는 Node.js 이미지, 빌드 작업은 `standard-2`, 그 외는 `standard-1` |
| Canary 롤아웃 예시 | Durable Object ID를 해시하여 새 샌드박스의 5%에 새 도구 체계 적용 |
| 준비된 시스템 이미지 구성 | `cloudflare/debian-trixie`, Debian Trixie Slim, Node.js 24.20.0 LTS |
| 시스템 이미지 시작 예시 | `standard-2`, `enableInternet: true`, 진입점은 `/bin/sleep infinity` |
| 기존 클래스 유지보수 기한 | `Container` 및 레거시 `Sandbox` 클래스는 2026-12-31까지 유지보수, 이후 기존 배포는 실행을 계속하지만 클래스 업데이트는 중단 |
{{% /details %}}
