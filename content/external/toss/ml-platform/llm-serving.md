---
title: "yaml 하나로 배포하는 vLLM·Triton·KServe 서빙 환경"
description: "LLM의 느린 추론과 복잡한 배포를 어떻게 개선했을까요? 토스증권은 vLLM과 Triton으로 추론을 빠르게 하고, 공용 Docker 이미지와 KServe로 모델러의 배포 작업을 yaml 하나로 줄였습니다."
date: 2026-11-14
weight: 6
---

# yaml 하나로 배포하는 vLLM·Triton·KServe 서빙 환경 (2024-11)

{{< callout type="info" >}}
**원문 정보**
- 원문: [LLM 쉽고 빠르게 서빙하기](https://toss.tech/article/llm-serving)
- 매체 · 게시일: 토스 기술 블로그 · 2024-11-26
- 저자: 김민규 (토스증권 ML Engineer)
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 좋은 모델 앞에 남은 서빙 작업 {#two-difficulties}

구슬이 서 말이라도 꿰어야 보배입니다. 토스증권은 투자 데이터를 이해하고 더 나은 금융 서비스를 제공하려고 LLM을 자체 학습해 서비스에 적용하는 데 집중했습니다. 하지만 중간 크기인 Llama3 8B도 일반 Transformers 패키지로 추론하면 단순한 질문에 수십 초를 기다려야 했습니다.

모델 비교도 쉽지 않았습니다. 어떤 모델이 서비스에 맞는지 판단하려면 여러 모델을 올려 A/B 테스트를 해야 하는데, 서빙하려는 모델러에게는 Docker 이미지 빌드와 Kubernetes manifest 작성 지식까지 필요했습니다. 모델을 잘 학습하는 일만으로 끝나지 않았던 것입니다. 서비스와 모델러가 늘어날수록 이런 학습 비용도 커졌습니다.

## 여러 서비스가 함께 쓰는 Docker 이미지 {#deployment-hurdle}

토스증권의 Kubernetes 환경에서는 hello world 서버도 준비할 파일이 많았습니다. 서버 이미지와 실행 명령을 담은 `deployment`, 외부 트래픽을 연결하는 `virtualservice`와 `service` 등을 Helm Charts로 작성해야 했습니다. 추론에 vllm을, 서빙 프레임워크로 Triton Inference Server(TIS)를 쓰려면 서버 코드 외에도 KV cache 크기, GPU 수, 최대 생성 길이 같은 설정이 필요합니다.

기존에는 추론 코드를 작성하고 Docker 이미지로 빌드한 뒤, 배포용 yaml을 만들어 ArgoCD로 Kubernetes에 올렸습니다. 토스증권은 이 과정에서 여러 서비스가 공유할 수 있는 코드를 공통화하고, 서비스마다 달라지는 설정은 변수로 만들었습니다.

그 바탕으로 쓴 도구가 Triton의 오픈소스 `vllm_backends`입니다. vllm 설정과 모델 경로를 파일 하나에 정의하면 Triton 서버에서 실행할 수 있게 돕습니다. 여기에 토스증권 인프라에 맞는 model registry를 구성하고 필요한 설정을 변수화해, 여러 서비스가 하나의 Docker 이미지를 공유하도록 했습니다. 이제 모델러는 이미지를 따로 빌드하지 않고도 모델과 설정을 바꿔 LLM 서버를 띄울 수 있습니다.

배포 절차는 KServe로 줄였습니다. Kubeflow 위에서 머신러닝 모델의 배포와 관리를 돕는 서버리스 플랫폼입니다. 모델러는 학습한 모델 이름과 GPU 수 같은 설정을 yaml 하나에 적어 제출하면 됩니다. 예시의 `InferenceService`에는 공용 Triton 이미지, 모델 이름을 넘기는 command, `nvidia.com/gpu: "1"` 자원 요청이 들어갑니다. 모델마다 코드와 이미지를 준비하던 작업이 공용 이미지와 yaml 하나를 사용하는 과정으로 바뀐 것입니다.

## 서빙 편의까지 따져 고른 vllm {#inference-speed}

배포를 간소화하는 동안 추론의 기다림도 줄여야 했습니다. ChatGPT, Claude, Gemini 같은 서비스의 최신 모델은 2~3문단을 수 초에 쓰지만, Llama3 70B나 Mixtral 8x22B를 사용하면 GPU가 있어도 비슷한 분량의 토큰을 만드는 데 수 분, 길게는 수십 분이 걸리는 경우가 있었습니다.

LLM은 앞서 생성한 결과를 입력으로 삼아 다음 토큰을 만드는 autoregressive 모델입니다. 토큰을 순서대로 생성해야 합니다. `안녕하세요. 토스 테크 블로그입니다.`도 `안녕하세요. -> 토스 -> 테크 -> 블로그입니다.` 순으로 만들어집니다.

순차 생성이라는 특성을 바꾸지는 못해도, 이미 계산한 부분은 재사용할 수 있습니다. `테크`를 생성할 때 사용한 앞선 토큰 `안녕하세요.`와 `토스`는 다음의 `블로그입니다.`를 생성할 때도 필요합니다. 이렇게 겹치는 토큰의 attention 계산에 필요한 key와 value를 저장해 다시 쓰는 방법이 KV cache입니다. 중복 계산을 줄여 추론 속도를 `O(n^3)`에서 `O(n^2)`까지 개선할 수 있습니다. 메모리를 더 효율적으로 쓰는 paged KV cache, CUDA를 더 효율적으로 사용하는 kernel fusion도 추론을 빠르게 하는 방법입니다.

이런 최적화를 적용한 런타임으로 tensorrt-llm, vllm, lmdeploy, tgi가 있습니다. 토스증권은 초당 생성 토큰 수인 TPS와 첫 토큰이 나올 때까지의 시간인 TTFT를 비교했습니다. 생성 모델은 요청마다 출력할 토큰 수가 크게 달라 초당 요청 수로는 정확한 비교가 어렵습니다. 그래서 TPS를 사용했고, TTFT로는 각 프레임워크가 GPU inference의 warm-up 시간을 얼마나 줄이는지 살폈습니다.

빠르기만 해서는 충분하지 않았습니다. 학습한 모델을 서빙하기까지 거치는 단계도 비교 대상입니다. ONNX처럼 컴파일 과정이 필요한 방식은 토스증권이 사용성을 낮게 평가한 예였습니다. Llama, Gemma, Mixtral, Qwen처럼 자주 쓰는 pretrained 아키텍처를 모두 지원하는지도 확인했습니다.

2024년 9월 5일 내부 비교표는 Llama3 8B를 기준으로 작성했습니다. 여러 아키텍처를 시험한 결과까지 종합해 고른 런타임이 vllm입니다. 정량 지표에서 빠른 편에 속하면서 사용하기 편하고, 다양한 모델을 지원한다는 점을 함께 평가했습니다. 이를 서빙할 Triton은 범용적으로 널리 쓰이고 dynamic batching, continuous batching 등 throughput을 높이는 기능을 제공하며, vllm용 backend도 직접 오픈소스로 제공한다는 점이 선택 이유였습니다.

## 새 서버의 상태를 확인하는 Grafana {#result}

서버를 띄운 다음에는 동작과 성능을 확인해야 합니다. KServe와 Triton은 정형화된 로그를 남기므로 새 서버도 별다른 노력 없이 대시보드에 추가할 수 있습니다. Grafana에서 TPS와 latency를 확인하고 오류 알림을 설정해 바로 대응할 수 있는 환경입니다.

새 pretrained 모델이나 간단히 학습해 본 모델을 서빙해 시험하는 일도 쉬워졌습니다. 기존에 하기 어려웠던 Llama 70B와 자체 모델의 성능 벤치마크가 가능해졌고, 큰 모델을 이용해 양질의 데이터를 구축하기도 수월해졌습니다.

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
