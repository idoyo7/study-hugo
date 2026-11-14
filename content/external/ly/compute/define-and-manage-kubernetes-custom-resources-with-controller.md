---
title: "쿠버네티스 커스텀 리소스와 컨트롤러의 내부 동작"
description: "Cloud DBS 팀이 사내 클라우드 Verda의 Redis, MySQL, MongoDB, OpenSearch를 커스텀 리소스와 컨트롤러로 관리하는 방식을 정리한 글입니다. CRD 등록과 컨트롤러 작성 예시에 이어, 이벤트가 Informer와 WorkQueue를 거쳐 Reconcile에 닿는 과정을 요약합니다."
date: 2026-11-14
weight: 3
---

# 쿠버네티스 커스텀 리소스와 컨트롤러의 내부 동작 (2024-08)

{{< callout type="info" >}}
**원문 정보**
- 원문: [쿠버네티스 커스텀 리소스 정의하고 관리하기(feat.컨트롤러)](https://techblog.lycorp.co.jp/ko/define-and-manage-kubernetes-custom-resources-with-controller)
- 매체 · 게시일: LY Corporation Tech Blog · 2024-08-28
- 저자: 강인배, 문현균 (Cloud DBS 팀)
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

두 저자는 Cloud DBS 팀에서 사내 클라우드 Verda의 데이터베이스와 OpenSearch 서비스 개발을 맡고 있습니다. 글은 쿠버네티스 v1.21.9, controller-runtime v0.12.3, client-go v0.24.2 기준입니다.

## 컨트롤러의 기본 동작 {#controller-basics}

파드나 디플로이먼트 같은 쿠버네티스 리소스는 모두 같은 방식으로 관리됩니다. 리소스가 바뀌면 변경이 감지돼 컨트롤러로 이벤트가 전달되고, 컨트롤러는 Reconcile 함수로 리소스가 원하는 상태(desired status)가 될 때까지 조정합니다. 디플로이먼트를 만들면 컨트롤러가 스펙의 `replicas`만큼 파드를 만들고, `replicas`를 2에서 3으로 바꾸면 이벤트가 디플로이먼트 컨트롤러로 가서 모자란 파드 하나를 새로 만듭니다. 원문은 설명을 쉽게 하려고 디플로이먼트와 파드 사이의 레플리카셋을 생략했다고 밝힙니다.

## 팀의 활용 사례 {#use-case}

팀은 Redis Services라는, 쿠버네티스에 기본으로 없는 리소스를 커스텀 리소스로 정의하고 컨트롤러를 만들어 관리합니다. Redis 외에 MySQL, MongoDB, OpenSearch도 같은 방식으로 제공합니다. 디플로이먼트가 `replicas`만큼 파드를 만들듯, Redis Service를 만들고 `replicas`를 지정하면 그 수만큼 VM이 만들어져 사용자에게 제공됩니다. 커스텀 리소스를 관리하는 컨트롤러가 VM을 만드는 것입니다. 사용법도 같아서 `kubectl get redisservice`로 조회하고 YAML에 스펙을 적어 `kubectl apply -f redisservice.yaml`로 생성한 뒤, 대응하는 서버가 잘 만들어졌는지 확인합니다.

## 커스텀 리소스 등록과 컨트롤러 작성 {#crd-and-controller}

예시는 Verda의 VM과 일대일로 대응하는 커스텀 리소스인 VerdaVM입니다. 먼저 쿠버네티스 API에 이 리소스를 등록해 API 서버가 VerdaVM의 CRUD를 제공하게 해야 합니다. 원문은 이를 블록을 만들어 기존 블록에 붙이는 일에 비유합니다. 블록을 만드는 일은 CustomResourceDefinition 매니페스트를 쓰는 것이고, 붙이는 일은 `kubectl apply -f`로 생성하는 것입니다.

컨트롤러의 목표는 리소스를 스펙대로 만드는 것이고, VM이라면 스펙(`flavor`, `image`)에 맞게 VM을 만들어 `ACTIVE` 상태로 두고 그 상태를 기록하는 일입니다. 핵심 로직은 두 가지입니다.

- VerdaVM 리소스가 생성되면 Verda에 실제 VM을 만든다. UUID 필드가 비어 있으면 아직 만들지 않은 것으로 보고 Verda의 VM 생성 API를 호출한 뒤, 전달받은 UUID를 리소스에 업데이트한다. UUID가 채워져 있으면 이미 생성된 것으로 보고 끝낸다.
- VM의 서버 상태를 확인해 `ACTIVE`에 도달했는지 검증한다. UUID가 없으면 생성될 때까지 기다리고, 있으면 상태를 보다가 `ACTIVE`가 아니면 일정 간격으로 API를 호출해 `ACTIVE`가 나올 때까지 갱신한다.

원문은 두 단계가 순차 실행이 아니라고 덧붙입니다. 동기화 함수가 모두 함께 수행되는데, 두 번째 로직이 첫 번째의 성공을 기다려 동작하기 때문에 나눠 설명한 것입니다.

## 컨트롤러 내부 동작 {#internals}

컨트롤러는 API 서버의 부하를 줄이고 속도를 높이려고 오브젝트를 직접 가져오지 않고 Informer를 거칩니다. Informer는 캐시 스토리지를 두고, Watch로 API 서버에서 오브젝트를 받아 캐시에 저장합니다. Watch는 `kubectl -w`와 같은 기능으로 리소스의 생성, 수정, 삭제 이벤트를 실시간으로 받습니다.

이벤트 경로는 다음과 같습니다.

- etcd와 API 서버 사이: etcd가 Watcher 인터페이스를 구현해 두어서 API 서버는 Watcher 클라이언트로 변화를 받는다. 받은 이벤트는 타입(`create`, `delete`, `update`)과 오브젝트만 있는 이벤트 구조체로 바뀐다.
- API 서버와 Informer 사이: Informer는 이벤트가 올 때마다 캐시를 갱신하고, 자신을 가진 컨트롤러들에 이벤트 구조체를 전달한다. API 서버는 `watchEncoder`로 이를 내려 준다.
- Informer 내부: Reflector가 streamWatcher로 받은 이벤트 구조체를 DeltaFIFO 큐에 넣는다. DeltaFIFO는 맵과 큐로 이뤄져, 맵에는 Delta를 값으로, 오브젝트의 namespacedName을 키(ID)로 저장하고 그 키가 큐에 없으면 큐에도 넣는다. 대기하던 goroutine이 ID를 하나씩 꺼내 캐시 스토리지를 갱신하는 Indexer와 핸들러가 있는 Processor로 Delta를 보내며, 같은 ID의 Delta를 모두 처리할 때까지 반복한다. 캐시 스토리지는 namespacedName을 키로 하는 스레드 세이프 맵이다.
- 이벤트 핸들러와 WorkQueue: Processor의 리스너가 타입에 따라 `OnAdd`, `OnUpdate`, `OnDelete`를 부르는데, 셋 모두 같은 일, 곧 `NamespacedName`만 담은 구조체를 WorkQueue에 푸시한다. WorkQueue를 가져가는 goroutine이 이것을 Reconcile 함수의 파라미터로 넘긴다.
- Reconcile: 보통 캐시 스토리지에서 오브젝트를 가져와 작업하고 API 서버에 업데이트한다. 원문은 Memcached-operator 예제를 참고 자료로 듭니다.

정리하면 API 서버가 etcd Watcher로 이벤트를 전하고, Reflector가 DeltaFIFO로 캐시를 갱신한 뒤 핸들러에 알리고, 핸들러가 Name과 Namespace를 WorkQueue에 넣고, Reconcile이 이를 키로 캐시에서 오브젝트를 읽어 처리한 뒤 API 서버를 호출(`POST`/`PUT`)해 상태를 갱신합니다. Redis의 `replicas`를 2에서 3으로 바꾸면 이 경로를 거쳐 캐시의 Redis Service가 갱신되고, Reconcile이 노드 개수를 확인한 뒤 노드를 하나 더 만듭니다(`POST`).

## 맺음 {#wrap-up}

컨트롤러를 만들어 리소스를 선언적으로 관리하는 방식을 오퍼레이터 패턴이라고 합니다. 원문은 처음부터 이 내용을 모두 파악하기는 어렵다며, Reconcile 내용만 구현하도록 스캐폴딩을 제공하고 Go 코드만으로 CustomResourceDefinition을 만들 수 있게 해 주는 Operator SDK를 팁으로 권합니다. 저자는 캐시 스토리지 때문에 어려움을 겪은 경험에서 내부 구조까지 살펴보게 됐고, 쿠버네티스 코드와 함께 보면 이해가 더 쉬울 것이라고 말합니다.
