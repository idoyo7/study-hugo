---
title: "Verda VM을 원하는 상태로 만드는 쿠버네티스 컨트롤러"
description: "쿠버네티스에 등록한 커스텀 리소스는 어떻게 Verda의 실제 VM으로 이어질까요? Cloud DBS 팀의 컨트롤러는 UUID로 VM 생성 여부를 판단해 VM을 만들고, ACTIVE에 도달할 때까지 상태를 확인합니다."
date: 2026-11-14
weight: 3
---

# Verda VM을 원하는 상태로 만드는 쿠버네티스 컨트롤러 (2024-08)

{{< callout type="info" >}}
**원문 정보**
- 원문: [쿠버네티스 커스텀 리소스 정의하고 관리하기(feat.컨트롤러)](https://techblog.lycorp.co.jp/ko/define-and-manage-kubernetes-custom-resources-with-controller)
- 매체 · 게시일: LY Corporation Tech Blog · 2024-08-28
- 저자: 강인배, 문현균 (Cloud DBS 팀)
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

Cloud DBS 팀은 쿠버네티스에서 Redis Service의 `replicas`를 지정해 사내 클라우드 Verda에 VM을 만듭니다. VM을 생성하는 주체는 커스텀 리소스를 관리하는 컨트롤러입니다. MySQL, MongoDB, OpenSearch도 같은 방식으로 제공합니다.

설명은 쿠버네티스 v1.21.9, controller-runtime v0.12.3, client-go v0.24.2를 기준으로 합니다.

## 파드 대신 VM을 만드는 Redis Service {#use-case}

컨트롤러는 리소스가 바뀌었다는 이벤트를 받으면 Reconcile 함수로 현재 상태를 스펙이 요구하는 상태에 맞춥니다. 디플로이먼트의 `replicas`가 2이면 파드를 두 개 만들고, 3으로 바뀌면 부족한 하나를 더 만드는 식입니다. 실제로는 디플로이먼트와 파드 사이에 레플리카셋이 있지만, 여기서는 컨트롤러의 동작을 설명하기 위해 중간 과정을 생략한 것입니다.

팀이 직접 정의한 Redis Services도 이 방식을 따릅니다. Redis Service를 생성하고 `replicas`를 지정하면 컨트롤러가 그 수에 맞게 VM을 만들어 사용자에게 제공합니다.

사용하는 명령도 파드를 다룰 때와 같습니다. `kubectl get redisservice`로 리소스를 조회하고, YAML에 스펙을 적어 `kubectl apply -f redisservice.yaml`로 생성합니다. 이후에는 커스텀 리소스에 대응하는 서버가 잘 만들어졌는지 확인하는 과정입니다.

## 쿠버네티스 API에 붙이는 VerdaVM 블록 {#crd-and-controller}

VerdaVM은 Verda의 실제 VM과 일대일로 대응하는 커스텀 리소스입니다. 이를 사용하려면 API 서버가 VerdaVM의 CRUD를 제공하도록 CustomResourceDefinition(CRD)을 등록해야 합니다.

쿠버네티스 API를 블록 장난감에 빗대면, CRD 매니페스트를 작성하는 일은 새 블록을 만드는 과정입니다. `kubectl apply -f verdaVM-crd.yaml`로 등록하면 그 블록이 기존 API에 붙습니다. 이제 컨트롤러와 클라이언트가 쿠버네티스 API에서 VerdaVM을 조회하거나 업데이트할 수 있습니다.

### ACTIVE 상태까지 확인하는 컨트롤러

API에 리소스를 등록한 뒤에는 실제 VM을 관리할 컨트롤러가 필요합니다. 목표는 `flavor`, `image` 스펙에 맞는 VM을 만들고, VM이 `ACTIVE`에 도달하면 그 상태를 기록하는 것입니다.

VM 생성 여부는 UUID 필드로 판단합니다. UUID가 비어 있으면 아직 VM을 만들지 않았다고 보고, Verda의 VM 생성 API를 호출한 뒤 전달받은 UUID를 VerdaVM 리소스에 기록합니다. 이미 UUID가 있다면 생성 로직은 종료합니다.

상태 확인은 UUID가 있어야 진행되는 작업입니다. UUID가 없으면 기다리고, 있다면 API로 서버 상태를 조회합니다. 아직 `ACTIVE`가 아니면 일정 간격으로 API를 호출하면서 상태를 갱신하고, `ACTIVE`라는 결과를 받으면 이를 리소스에 기록한 뒤 종료합니다.

생성과 상태 확인을 나눠 설명했지만, 각 동기화 함수가 순서대로 실행되는 것은 아닙니다. 함수들은 함께 수행되며, 상태 확인의 주요 로직이 VM 생성 성공을 기다린 뒤 작동하는 관계입니다.

이처럼 컨트롤러를 작성해 리소스를 선언적으로 관리하는 방식을 오퍼레이터 패턴이라고 합니다. 처음부터 모든 내부 동작을 파악하기 어렵다면 Operator SDK의 도움을 받을 수 있습니다. Reconcile의 내용을 구현할 수 있도록 스캐폴딩을 제공하고, Go 코드만으로 CRD를 생성하는 기능도 갖춘 도구입니다.

## 이름으로 캐시를 읽는 Reconcile {#internals}

저자들은 컨트롤러를 작성하면서 캐시 스토리지 때문에 어려움을 겪었고, 내부 동작을 파악한 뒤에야 문제가 생기는 위치와 해결 방법을 알게 됐습니다. 컨트롤러는 API 서버의 부하를 줄이고 속도를 높이려고 Informer를 사용합니다. Reconcile이 일반적으로 오브젝트를 가져오는 곳도 이 Informer의 캐시 스토리지입니다.

Reconcile에 도착하는 것은 오브젝트 전체가 아닙니다. 이벤트 핸들러의 `OnAdd`, `OnUpdate`, `OnDelete`는 모두 `NamespacedName`만 담은 구조체를 WorkQueue에 넣습니다. 생성·수정·삭제 중 어떤 이벤트였든 큐에 넣는 정보는 이름과 네임스페이스뿐입니다. WorkQueue에서 요청을 꺼내는 goroutine이 이 구조체를 Reconcile의 파라미터로 전달합니다.

Reconcile은 그 이름을 키로 캐시에서 오브젝트를 읽고, 필요한 작업을 수행한 뒤 API 서버를 호출해 상태를 업데이트합니다(`POST`/`PUT`). Memcached-operator 예제에서도 `req.NamespacedName`으로 오브젝트를 가져와 작업하고 상태를 갱신하는 흐름을 확인할 수 있습니다.

## WorkQueue보다 먼저 갱신되는 Informer 캐시 {#informer-cache}

Informer는 Watch로 리소스의 생성·수정·삭제를 실시간으로 감지하고 캐시를 갱신합니다. `kubectl -w`와 같은 기능입니다. Reconcile이 읽을 오브젝트가 캐시에 들어오는 과정을 따라가면 API 서버와 etcd까지 이어집니다.

etcd는 Watcher 인터페이스를 구현하고 있어서 API 서버가 Watcher 클라이언트로 오브젝트의 변화를 전달받습니다. 받은 이벤트를 변환한 구조체에는 타입(`create`, `delete`, `update`)과 오브젝트가 들어갑니다. API 서버는 자신을 Watch하는 Informer에 `watchEncoder`로 이벤트 구조체를 전달합니다.

Informer 안에서는 Reflector가 streamWatcher로 받은 이벤트를 DeltaFIFO에 넣습니다. DeltaFIFO는 맵과 큐로 이뤄진 구성입니다. 맵에는 이벤트를 Delta로 바꿔 값으로 저장하고, 키(ID)는 오브젝트의 `namespacedName`으로 정합니다. 그 키가 큐에 없다면 큐에도 추가합니다.

대기하던 goroutine은 큐에서 ID를 하나씩 꺼내 그 ID에 쌓인 Delta를 모두 처리합니다. 각 오브젝트를 Indexer로 보내 캐시를 갱신한 다음 Processor에 전달하는 과정입니다. 캐시 스토리지는 `namespacedName`을 키로, 오브젝트를 값으로 저장하는 스레드 세이프 맵입니다.

Processor의 리스너가 알림 타입에 맞는 이벤트 핸들러를 호출하면, 앞서 본 WorkQueue에 이름을 넣는 작업으로 이어집니다. 캐시를 갱신한 뒤 핸들러에 알리는 순서입니다.

Redis Service의 `replicas`를 2에서 3으로 바꾸는 경우에도 이 순서를 따릅니다. Watch로 전달된 이벤트가 DeltaFIFO를 거쳐 캐시의 `replicas`를 3으로 바꾸고, `OnUpdate`가 호출되면 Redis Service의 `namespacedName`이 WorkQueue에 들어갑니다. Reconcile은 그 이름으로 캐시에서 오브젝트를 읽어 노드 개수를 확인한 뒤, 부족한 노드 하나를 더 만듭니다(`POST`).
