---
title: "호출이 뜸한 모델을 한 GPU에 모은 Cloudflare Omni"
description: "Cloudflare는 드물게 호출되는 모델이 GPU 공간을 차지하는 문제를 Omni로 풀었습니다. GPU 메모리를 초과 할당하고 모델별 실행 환경을 격리해 한 GPU에서 더 많은 모델을 실행합니다."
date: 2026-11-16
weight: 8
---

# 호출이 뜸한 모델을 한 GPU에 모은 Cloudflare Omni (2025-08)

{{< callout type="info" >}}
**원문 정보**
- 원문: [How Cloudflare runs more AI models on fewer GPUs: A technical deep-dive](https://blog.cloudflare.com/how-cloudflare-runs-more-ai-models-on-fewer-gpus)
- 매체 · 게시일: The Cloudflare Blog · 2025-08-27
- 저자: Sven Sauleau, Mari Galicer
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 드물게 불려도 자리를 차지하는 모델 {#underused-models}

Workers AI의 모델 목록이 늘어도 모든 모델에 요청이 고르게 들어오지는 않았습니다. 호출은 뜸한데 GPU 공간은 계속 차지하는 모델이 문제였습니다. Cloudflare가 만든 내부 플랫폼 Omni는 작은 모델이나 트래픽이 적은 모델을 한 머신과 GPU에 모아 실행합니다.

모델마다 GPU가 붙은 컨테이너나 VM을 마련하는 구성은 단순합니다. 운영에 드는 일은 많습니다. VM 준비부터 GPU 드라이버 설치, 가중치 다운로드, Python 환경 관리까지 챙겨야 하며, 규모가 커지면 전담 팀이 필요한 경우도 많아집니다. Omni는 여러 모델을 단일 제어 평면에서 관리하고, 가벼운 격리로 빠르게 시작하거나 종료하도록 설계했습니다.

Cloudflare는 GPU를 사용자와 애플리케이션에 최대한 가까이 배치하려 합니다. Omni로 각 노드에서 실행하는 모델 수를 늘리면서 모델 가용성을 높이고, 지연과 유휴 GPU의 전력 소비를 줄였습니다.

## 13개 모델이 나눠 쓰는 GPU 메모리 {#gpu-memory-overcommit}

Cloudflare가 소개한 설정에서는 GPU 하나에 모델 13개를 배치하고 GPU 메모리의 약 400%를 할당합니다. 이 설정으로 GPU 4개를 절약한다고 설명합니다. 물리 용량을 넘겨 메모리를 배정하되, 모든 모델을 GPU 메모리에 계속 두지는 않는 방식입니다.

Omni는 CUDA stub 라이브러리를 주입해 `cuMalloc*` 또는 `cudaMalloc*` 메모리 할당 호출을 가로챕니다. 할당은 Unified memory 모드로 바뀝니다. CPU와 GPU가 같은 메모리 주소 공간을 공유하므로, 모델 데이터가 CPU 메모리와 GPU 메모리 사이를 오갈 수 있습니다.

모델 A와 B는 함께 GPU 메모리에 들어가고, C는 혼자 GPU 메모리 전체를 쓰는 예를 생각해 보겠습니다. 처음에는 A와 B가 GPU에, C가 CPU 메모리에 있습니다. C 요청이 들어오면 A와 B를 CPU 메모리로 옮기고 C를 GPU로 가져옵니다. 이어 B가 호출되면 C의 일부를 내보내 B가 돌아올 자리를 마련합니다. A까지 다시 호출되면 C는 완전히 CPU 메모리로 돌아갑니다. 시간이 지나면서 사용하지 않는 모델은 CPU 메모리에 머물고, 활발히 쓰는 모델은 GPU에 남습니다.

GPU로 돌아오는 데는 시간이 듭니다. 작은 모델은 PCIe 4.0의 32 GB/sec 대역폭 덕에 추가 지연이 작지만, 오래 쓰지 않아 밀려난 큰 모델은 가중치와 캐시 전체를 다시 옮겨야 할 수 있습니다. 가중치와 캐시가 5 GiB인 모델의 복귀 시간 약 156 ms는 이 대역폭을 기준으로 든 예입니다.

초과 할당만으로는 모델의 메모리 사용을 제어하기 어렵습니다. AI 프레임워크는 성능을 위해 가능한 한 많은 GPU 메모리를 미리 할당하는 경향이 있기 때문입니다. Omni는 `cudaMemGetInfo`와 `cuMemGetInfo`를 재정의해 각 모델에 전체 GPU 메모리의 일부만 보여 줍니다. 특정 모델이 자신에게 배정된 용량을 과도하게 쓰지 못하도록 제한하는 장치입니다.

## 모델별 한도가 보이는 실행 환경 {#process-and-python-isolation}

CPU 메모리에서도 모델이 보는 용량과 실제 한도를 맞춰야 했습니다. Python은 메모리를 할당할 때 cgroup 메모리 한도를 고려하지 않습니다. 여러 AI Python 라이브러리가 CPU 메모리를 미리 확보할 때 쓰는 psutil도 `/proc/meminfo`를 읽으므로, 그대로 두면 모델별 한도 대신 시스템 전체 메모리를 기준으로 삼습니다.

Cloudflare는 FUSE 가상 파일 시스템으로 모델의 현재 사용량과 한도를 반영한 `/proc/meminfo`를 마운트했습니다. 컨테이너 전체 메모리가 15 GiB여도, 한도가 7 GiB인 모델에는 자기 한도가 보입니다. 이 모델이 7 GiB를 넘게 할당하려 하면 OOM으로 종료되고 scheduler의 프로세스 관리자가 재시작합니다. 다른 모델에는 영향을 주지 않습니다.

이 격리는 컨테이너 안에서만 쓰이지 않습니다. Omni는 컨테이너 하나에서 여러 모델을 실행하는 구성과 bare metal에서 단일 모델을 실행하는 구성으로 배포됩니다. 두 구성 모두 namespace로 프로세스를 격리하고 cgroup으로 자원 사용을 제한합니다. 모델마다 프로세스를 나누면 CUDA context도 분리돼 오류 복구를 모델별로 처리할 수 있습니다.

Python과 일부 시스템 의존성은 uv가 관리하는 모델별 Python 가상 환경에 둡니다. 실행 환경을 분리해도 의존성을 매번 따로 저장하지는 않습니다. 머신에 캐시한 의존성을 가능한 경우 모델끼리 공유하며, uv는 캐시와 가상 환경 사이에 심볼릭 링크를 사용합니다.

## 모델 생명주기를 관리하는 scheduler {#routing-and-control-plane}

모델을 시작하고 요청을 배분하며 실패한 프로세스를 복구하는 일은 scheduler가 맡습니다. Omni의 단일 제어 평면입니다. 트래픽이 늘면 새 모델 인스턴스를 준비하고, 시작할 때 가중치와 Python 코드, 의존성을 내려받습니다. 여러 GPU에 부하를 분산하고 프로세스 상태를 확인하며, 새 버전 배포와 오류 복구도 관리합니다. 과금용 메트릭과 로그 역시 여기서 수집합니다.

요청을 어느 Omni로 보낼지는 라우팅 계층이 결정합니다. Workers AI에 추론 요청이 들어오면 Workers KV에서 모델 설정을 읽고, 가용 용량이 있는 가장 가까운 Omni 인스턴스로 전달합니다. Asynchronous Batch API 요청은 유휴 인스턴스로 향합니다. 보통 밤 시간대인 지역의 인스턴스가 여기에 해당합니다.

Omni는 요청 검사와 모델별 전처리·후처리를 맡고, 실제 추론은 scheduler가 감독하는 모델별 프로세스가 수행합니다. 프로세스는 요청과 메타데이터를 받아 응답을 돌려줍니다. 모델에 따라 JSON 객체나 텍스트 생성용 SSE 스트림, 이미지 생성용 바이너리처럼 응답 형태도 달라집니다.

scheduler와 자식 프로세스는 프로세스 간 통신인 IPC로 메시지를 주고받습니다. 일반적으로는 scheduler가 요청을 버퍼링해 프롬프트 템플릿이나 tool calling을 적용한 뒤 자식 프로세스에 전달합니다. 본문이 클 수 있는 바이너리 요청에서는 TCP 연결 자체를 넘깁니다. 자식 프로세스가 요청 본문을 직접 읽도록 하는 방식입니다.

## Workers AI로 이어지는 공통 Python API {#inference-engine-integration}

vLLM, Python, Cloudflare 자체 추론 엔진 Infire처럼 모델을 실행하는 백엔드는 다양합니다. 어느 백엔드를 쓰든 모델은 batching과 function calling 같은 Workers AI 기능을 지원해야 합니다. Omni는 여러 백엔드를 내부 라우팅·스케줄링 시스템에 연결하고, 엔지니어가 Python API로 새 모델을 추가할 수 있게 합니다.

모델 로직을 실행하는 방식은 JavaScript Worker와 비슷합니다. Omni가 요청 핸들러를 호출하면 핸들러가 작업을 수행하고 응답을 반환합니다. 비동기 함수도 허용하며, pydantic 객체를 비롯한 여러 반환형은 Omni가 Workers AI 응답으로 변환합니다.

의존성은 `requirements.txt`에 선언하고 모델 시작 시 설치합니다. 이를 위해 Cloudflare는 내부 Python registry와 공개 registry의 미러를 운영합니다. 요청 처리와 응답 생성, 오류 처리에 쓰는 API는 모델에 주입하는 `omni` 패키지에 들어 있습니다. 이 패키지는 독립적으로도 사용할 수 있어 모델 핸들러의 단위 테스트에도 활용합니다.

게시 시점에 Omni는 Workers AI 목록의 일부 모델에서 production으로 운영 중이었으며, 적용 모델은 매주 늘고 있었습니다.

{{% details title="메모리 설정과 전송 시간 예시" closed="true" %}}
| 항목 | 값 |
|---|---|
| CPU 메모리 격리 예시 | 모델 한도 7 GiB, 컨테이너 전체 15 GiB |
| CPU 메모리 한도 초과 시 동작 | 예시 모델이 7 GiB를 넘게 할당하려 하면 OOM 종료 후 재시작 |
| GPU 메모리 초과 할당의 개념 예시 | 물리 메모리 10 GiB인 GPU에 각각 10 GiB를 할당하는 모델 2개 허용 |
| 글에서 소개한 단일 GPU 설정 | 모델 13개, GPU 메모리 약 400% 할당 |
| 해당 설정의 GPU 절감 설명 | GPU 4개 절약 |
| 전송 대역폭 설명에 사용한 규격 | PCIe 4.0, 32 GB/sec |
| 큰 모델의 GPU 복귀 시간 예시 | 가중치와 캐시 5 GiB를 다시 옮기는 데 약 156 ms |
{{% /details %}}
