---
title: "vLLM, Triton, KServe로 간소화한 토스증권의 LLM 서빙"
description: "토스증권이 자체 학습한 LLM의 추론 속도와 배포 허들을 풀려고 vLLM과 Triton Inference Server를 고르고 KServe로 배포를 yaml 한 장으로 줄인 과정을 요약했습니다."
date: 2026-11-14
weight: 6
---

# vLLM, Triton, KServe로 간소화한 토스증권의 LLM 서빙 (2024-11)

{{< callout type="info" >}}
**원문 정보**
- 원문: [LLM 쉽고 빠르게 서빙하기](https://toss.tech/article/llm-serving)
- 매체 · 게시일: 토스 기술 블로그 · 2024-11-26
- 저자: 김민규 (토스증권 ML Engineer)
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 서빙에서 만난 두 가지 어려움 {#two-difficulties}

토스증권은 투자 데이터를 이해하고 더 나은 금융 서비스를 내놓으려고 LLM을 자체 학습해 서비스에 적용하는 데 집중하고 있습니다. 원문은 구슬이 서 말이라도 꿰어야 보배라며, 좋은 모델을 학습해도 서비스에 올리지 못하면 의미가 없다고 합니다. 일정 수준 이상의 LLM을 서비스에 올릴 때 어려움은 둘입니다.

- 속도: 중간 크기인 Llama3 8B를 일반 Transformers 패키지로 추론하면 단순한 질문에도 수십 초를 기다려야 합니다.
- 사용성: 어떤 모델이 서비스에 맞는지 알려면 여러 모델을 올려 A/B 테스트해야 하는데, 서빙하려면 Docker 이미지 빌드나 Kubernetes manifest 작성 같은 지식이 필요합니다. 이 허들 때문에 여러 모델을 서빙해 비교하기 어렵습니다.

## 추론 속도와 런타임 선택 {#inference-speed}

Llama3 70B나 Mixtral 8x22B처럼 성능이 좋다고 알려진 모델은 GPU를 써도 비슷한 분량의 토큰을 만드는 데 수 분, 길게는 수십 분이 걸리기도 합니다. 원인은 autoregressive 모델의 특성입니다. 이전 결과를 입력으로 다음 토큰을 만들기 때문에 토큰을 순차적으로 생성해야 합니다. 이 구조 자체는 바꿀 수 없지만 캐시로 빠르게 할 수 있습니다. self attention에서 앞선 토큰들의 key와 value는 겹치므로, 한 번 계산한 attention을 KV cache에 두고 재사용합니다. 원문은 이로써 추론 속도를 `O(n^3)`에서 `O(n^2)`까지 개선할 수 있다고 설명하고, 메모리를 더 효율적으로 쓰는 paged KV cache와 CUDA를 더 효율적으로 쓰는 kernel fusion도 언급합니다.

이런 개념을 적용한 오픈소스로 tensorrt-llm, vllm, lmdeploy, tgi가 있고, 토스증권은 세 가지 기준으로 비교했습니다.

- 정량적 지표: 초당 생성 토큰 수(TPS)와 첫 토큰까지의 시간(TTFT)입니다. 생성 모델은 요청마다 만드는 토큰 수가 크게 달라 초당 요청 수는 비교가 어려워 토큰 수로 비교했고, TTFT로는 프레임워크별 warm-up 단축 정도를 봅니다.
- 사용성: 학습한 모델을 얼마나 적은 단계로 서빙할 수 있는가입니다. ONNX처럼 컴파일 과정이 필요한 것은 사용성이 좋지 않다고 봤습니다.
- 지원하는 모델 종류: Llama, Gemma, Mixtral, Qwen 같은 흔한 pretrained 아키텍처를 모두 지원하는가입니다.

Llama3 8B로 2024년 9월 5일 토스증권 내부에서 테스트한 결과, 정량 지표가 빠른 편이면서 사용성이 편하고 다양한 모델을 지원하는 vllm을 골랐습니다. 서빙 프레임워크는 Triton Inference Server(TIS)로 정했습니다. 가장 범용적으로 쓰이고, dynamic batching과 continuous batching처럼 throughput을 올리는 기능이 있으며, vllm용 backend를 직접 오픈소스로 제공하기 때문입니다.

## 배포 허들 낮추기 {#deployment-hurdle}

토스증권은 여러 서비스를 Kubernetes로 관리합니다. 단순한 hello world 서버도 Helm Charts에 Docker 이미지, `deployment`, `virtualservice`, `service` 같은 여러 manifest가 필요하고, vllm과 Triton까지 쓰면 서버 코드와 KV cache 크기, GPU 수, 최대 생성 길이 같은 configuration, 그리고 이를 담은 Docker 이미지 빌드까지 알아야 합니다. 모델을 서비스로 내보내려면 모델뿐 아니라 vllm, Triton, Docker, K8s를 전반적으로 알아야 하고, 서비스와 모델러가 늘수록 이 학습 비용이 커집니다. 기존 흐름은 추론 코드를 쓰고, Docker 이미지로 빌드하고, yaml을 작성한 뒤 ArgoCD로 K8s에 배포하는 것이었습니다.

해법은 세 가지로 나뉩니다.

- 추론 코드: Triton이 제공하는 오픈소스 `vllm_backends`를 썼습니다. vllm 구성과 모델 경로를 파일 하나로 정의하면 Triton 서버에서 바로 실행됩니다.
- 이미지 공유: 토스증권 인프라에 맞춰 model registry를 구성하고 필요한 configuration을 변수화해, 하나의 Docker 이미지를 여러 서비스가 공유하게 했습니다. 모델러는 이미지를 따로 빌드하지 않고도 다양한 모델과 구성으로 LLM 서버를 띄울 수 있습니다.
- 배포: Kubeflow 위의 서버리스 플랫폼인 KServe를 도입했습니다. 모델러는 모델 이름과 GPU 수 같은 몇 가지 configuration을 넣은 yaml 하나만 제출하면 서버가 뜹니다. 원문 예시는 `InferenceService`에 공용 Triton 이미지, 모델 이름을 넘기는 command, `nvidia.com/gpu: "1"` 요청을 적은 yaml입니다.

KServe와 Triton은 로그를 정형화된 형태로 남기므로 별도 노력 없이 대시보드에 새 서버를 추가할 수 있습니다. Grafana에서 TPS와 latency를 보고, 알림을 쉽게 설정해 오류에 바로 대응합니다.

## 결과 {#result}

새 pretrained 모델이 나오거나 간단히 학습한 모델을 쉽게 서빙해 테스트할 수 있는 환경이 됐습니다. 원문은 이로써 기존에 하기 힘들던 Llama 70B와 자체 모델의 성능 벤치마크가 가능해졌고, 큰 모델로 양질의 데이터를 구축하기도 쉬워졌다고 합니다. 마무리에서는 LLM의 가치가 더 나은 모델을 만드는 데서 끝나지 않고 서비스에 어떻게 연결하느냐에 달렸다고 말합니다.

{{% details title="런타임 비교 기준과 서빙 구성" closed="true" %}}

| 항목 | 값 |
|---|---|
| 비교 대상 런타임 | tensorrt-llm, vllm, lmdeploy, tgi |
| 비교 기준 | TPS, TTFT, 사용성, 지원 모델 종류 |
| 테스트 모델 / 시점 | Llama3 8B / 2024-09-05 토스증권 내부 테스트 |
| 선택 | vllm + Triton Inference Server (vllm_backends) |
| 배포 | KServe `InferenceService` yaml 하나 |
| 예시 yaml의 자원 | GPU 1장, 64G 메모리 emptyDir을 `/dev/shm`에 마운트 |

{{% /details %}}
