---
title: "Cloudflare 엣지의 CPU 부담을 줄인 추론 엔진 Infire"
description: "다른 서비스와 CPU를 나눠 쓰는 Cloudflare 엣지에서 추론용 GPU를 어떻게 더 잘 활용할 수 있을까요? Rust 기반 Infire는 실행 오버헤드를 줄이고, 연속 배칭과 페이지 단위 KV 캐시로 더 많은 요청을 처리합니다."
date: 2026-11-16
weight: 7
---

# Cloudflare 엣지의 CPU 부담을 줄인 추론 엔진 Infire (2025-08)

{{< callout type="info" >}}
**원문 정보**
- 원문: [How we built the most efficient inference engine for Cloudflare’s network](https://blog.cloudflare.com/cloudflares-most-efficient-ai-inference-engine)
- 매체 · 게시일: The Cloudflare Blog · 2025-08-27
- 저자: Vlad Krasnov, Mari Galicer
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## GPU 증설만으로는 부족했던 Cloudflare 엣지 {#edge-inference-constraints}

Cloudflare는 인터넷에 연결된 전 세계 인구의 95%로부터 50ms 이내에 있는 분산 네트워크를 운영합니다. 대형 다중 GPU 노드에 집중하는 일반적인 AI 배포 방식과는 맞지 않는 환경입니다. Llama 4와 gpt-oss처럼 큰 모델까지 지원하려면 유휴 자원을 빠짐없이 쓰고, 모델을 배치할 위치도 유연하게 바꿔야 했습니다. GPU를 더 사는 것만으로는 부족했습니다.

기존에 대부분의 모델을 실행하던 vLLM은 강력한 하드웨어에서 특정 모델을 전담할 때 빛을 발합니다. Cloudflare도 여러 Workers AI 모델에 계속 사용하는 엔진입니다. 하지만 동적으로 바뀌는 워크로드와 분산 네트워크, 다른 서비스와 노드를 공유하는 보안 조건까지 Cloudflare에 맞춰 최적화하기는 어려웠습니다.

보안을 지키는 데도 비용이 들었습니다. Cloudflare는 외부 Python 프로세스를 강한 샌드박스 없이 다른 서비스 옆에서 실행할 수 없어, vLLM을 gvisor 안에서 구동했습니다. 가상화 계층은 실행 오버헤드를 더하고 이미 길었던 인스턴스 시작·종료 시간도 늘리는 요인이었습니다. 부하가 가득 찬 엣지 노드에서 gvisor 안의 vLLM은 최대 2.5 CPU 코어를 사용했습니다. 다른 주요 서비스와 CPU 시간을 두고 경쟁하면서 추론이 느려지고 GPU 활용률까지 낮아졌습니다.

Python과 여러 라이브러리의 추상화 계층은 저수준 최적화를 복잡하게 만들었습니다. MIG 없이 같은 GPU에 여러 모델을 함께 호스팅하지 못한다는 제약도 있었습니다. 여러 모델을 동적으로 스케줄링해 가동 중단 시간을 줄이려는 Cloudflare의 요구와 맞지 않는 지점입니다. 이런 우선순위가 vLLM 프로젝트의 목표와 맞지 않을 수 있다고 보고, Cloudflare는 Rust로 자체 추론 엔진 Infire를 만들었습니다.

## H100 NVL에서 벌어진 CPU 사용량 차이 {#benchmark-results}

Infire의 초기 목표는 vLLM의 추론 성능을 따라잡는 것이었습니다. 부하가 없는 H100 NVL 장비에서 Infire는 vLLM 0.10.0보다 추론 작업을 최대 7% 빠르게 완료했습니다. 성능을 따라잡고 조금 앞섰지만, Cloudflare가 더 크게 본 성과는 CPU 사용량입니다.

비교에는 H100 NVL GPU가 있는 엣지 노드와 ShareGPT v3 데이터셋을 사용했습니다. 프롬프트 4,000개를 동시 요청 200개로 처리하는 합성 벤치마크입니다. Infire와 bare metal의 vLLM, 실제 서비스에서 쓰는 gvisor 안의 vLLM을 비교했습니다. 다른 트래픽과 자원을 경쟁하는 상황을 모사하기 위해 gvisor에서 사용할 수 있는 CPU를 1개로 제한한 조건도 추가했습니다.

Infire는 40.91 requests/s를 처리하면서 CPU load 25%를 기록했습니다. gvisor 안의 vLLM은 CPU load가 250%였고, CPU를 1개로 제한한 조건에서는 처리량이 22.04 requests/s로 떨어졌습니다. GPU가 같아도 CPU를 얼마나 쓸 수 있는지가 추론 처리량에 영향을 준 결과입니다.

Cloudflare는 CPU 사용량을 크게 줄인 이유로 Infire를 신뢰할 수 있는 bare metal 프로세스로 실행한다는 점을 꼽습니다. 다른 서비스의 자원을 소모하던 부담을 줄였고, GPU 활용률은 80% 이상으로 올라 운영 비용도 낮아졌다고 보고했습니다.

## 한 번에 더 많은 요청을 처리하는 배처 {#continuous-batching-and-kv-cache}

클라이언트 요청은 hyper로 만든 OpenAI 호환 HTTP 서버가 받습니다. 적은 CPU 시간으로 수백 개 연결을 처리하는 서버입니다. 요청을 검증한 뒤 HuggingFace의 tokenizers crate로 입력을 숫자 토큰으로 바꾸고, 응답의 무작위성과 길이 등을 조절하는 매개변수와 함께 배처에 넘깁니다. 배처는 이 요청들을 모아 Infire 추론 엔진이 GPU에서 처리하도록 스케줄링합니다.

요청을 모으는 이유는 가중치를 읽는 비용에 있습니다. 추론 연산의 상당 부분은 벡터와 가중치 행렬의 곱셈인데, 가중치가 워낙 커서 메모리에서 가져오는 시간이 연산 비용을 지배합니다. 여러 연산을 큰 행렬 곱셈으로 묶으면 메모리 접근 비용을 나눠 부담할 수 있습니다. Nvidia GPU의 행렬 곱셈 전용 하드웨어인 Tensor Cores를 활용하는 데도 필요한 방식입니다.

프롬프트 토큰은 처음부터 모두 주어져 있으므로 병렬로 처리합니다. 이 과정이 prefill이며, 입력 토큰이 출력 토큰보다 대체로 저렴하고 빠른 이유 중 하나입니다. Infire는 여러 요청의 decode를 한 배치에 모으고, 남은 자리를 새 프롬프트의 prefill 토큰으로 채웁니다. continuous batching with chunked prefill이라고 부르는 방식입니다.

배처는 요청을 끝내는 일도 맡습니다. End of Stream 토큰에 도달한 요청은 처리를 마치고, 생성한 토큰은 디코더로 보내 텍스트로 바꿉니다.

### 요청과 함께 커지는 KV 캐시

배치를 크게 만들려면 메모리도 남아 있어야 합니다. Attention은 현재 토큰까지 계산한 KV 값을 읽는 연산입니다. 새 토큰을 생성할 때마다 이전 값을 전부 다시 계산하면 긴 문맥에서 실행 시간이 폭증하므로, KV 캐시에 저장해 재사용합니다.

그렇다고 요청마다 최대 문맥 길이만큼 캐시를 미리 잡아 둘 수는 없습니다. Llama 3의 최대 문맥은 128K 토큰입니다. 이만큼을 요청마다 사전 할당하면 H100에서 병렬로 처리할 수 있는 요청은 4개뿐입니다.

Infire는 캐시를 작은 페이지로 나누고, 요청에 할당한 공간이 부족해질 때만 페이지를 추가합니다. 대부분의 요청은 최대 문맥 길이에 도달하지 않습니다. 쓰지 않을 공간까지 미리 확보하지 않는 방식으로, 캐시 사전 할당 때문에 병렬 요청 수가 제한되는 문제를 피합니다.

## 가중치 적재와 나란히 준비하는 Hopper 커널 {#rust-components-and-startup}

요청을 처리하기 전, 모델을 처음 띄우는 과정에도 기다리는 시간이 있습니다. 자동 확장 서비스가 노드에 모델을 배정하면 R2에서 가중치를 가져와 그 노드에 캐시합니다. 이미 캐시가 있으면 재사용하고, 가중치가 준비되는 대로 GPU 메모리에 적재합니다.

옮겨야 할 데이터부터 큽니다. 대부분의 비양자화 모델이 쓰는 BF16은 가중치 하나에 2바이트가 필요한 형식입니다. Llama 3.1 8B는 약 16GB, Llama 4 Scout는 약 218GB의 메모리가 필요합니다. Infire는 Page Locked 메모리와 여러 CUDA 스트림의 비동기 복사를 조합해 이 전송을 가속합니다.

가중치를 옮기는 동안 커널도 준비합니다. 모델 매개변수에 맞는 커널을 JIT 컴파일해 GPU에 적재하므로, 모델 적재와 컴파일을 순서대로 기다리는 시간을 줄입니다. 디스크에서 Llama-3-8B-Instruct를 읽어 시작하는 데 걸린 시간은 4초 미만입니다.

커널 최적화의 대상은 Cloudflare가 사용하는 Nvidia Hopper GPU입니다. 특정 연산 커널에 이 아키텍처의 저수준 PTX 명령을 사용하고, hidden state 크기와 사전 크기, 실행 GPU에 맞춰 JIT 컴파일합니다. 큰 행렬 곱셈처럼 cuBLASlt가 더 빠르다고 판단한 연산에는 해당 라이브러리를 사용합니다.

커널을 호출하는 비용도 줄였습니다. Infire는 배치 크기마다 필요한 CUDA 그래프를 만들고 다음 실행에 재사용합니다. 여러 커널 호출을 하나의 그래프로 묶어 실행하면, 커널을 개별적으로 호출할 때보다 호출당 비용이 줄어듭니다.

## 첫 구현 뒤에 남은 최적화 {#remaining-optimizations}

게시 시점에 Infire는 Workers AI의 Llama 3.1 8B 모델을 구동하고 있었습니다. 아직 적용하지 않은 최적화도 남아 있습니다. Flash Attention 3는 통합 중이며, 대부분의 커널에는 kernel fusion을 적용하지 않았습니다. Cloudflare는 이런 최적화로 추론 속도를 더 높일 수 있을 것으로 기대합니다.

더 큰 모델을 위한 multi-GPU 지원과 양자화, 진정한 multi-tenancy는 다음 버전에 구현하려는 기능입니다. 같은 GPU에 여러 모델을 동적으로 배치하려는 요구는 Infire를 만든 배경이지만, 첫 구현에서 그 계획을 모두 마친 것은 아닙니다.

{{% details title="벤치마크 조건과 세부 수치·설정값" closed="true" %}}
| 항목 | 값 |
|---|---|
| 벤치마크 환경 | H100 NVL GPU가 있는 엣지 노드, ShareGPT v3, 프롬프트 4,000개, 동시 요청 200개 |
| Infire | 40.91 requests/s, 17,224.21 tokens/s, CPU load 25% |
| vLLM 0.10.0 bare metal | 38.38 requests/s, 16,164.41 tokens/s, CPU load 140% |
| gvisor 안의 vLLM | 37.13 requests/s, 15,637.32 tokens/s, CPU load 250% |
| CPU를 제한한 gvisor 안의 vLLM | 사용 가능한 CPU 1개, 22.04 requests/s, 9,279.25 tokens/s, CPU load 100% |
| 부하가 없는 장비의 초기 비교 | H100 NVL에서 Infire가 vLLM 0.10.0보다 추론 작업을 최대 7% 빠르게 완료 |
| 엣지 노드의 최대 부하 상황 | gvisor 안의 vLLM이 최대 2.5 CPU 코어 사용 |
| 디스크에서 모델을 읽는 시작 시간 | Llama-3-8B-Instruct 적재 시 4초 미만 |
| BF16 가중치 형식 | 가중치당 16비트·2바이트, 32비트 부동소수점과 같은 동적 범위에 더 낮은 정밀도 |
| BF16 모델 메모리 예시 | Llama 3.1 8B는 약 80억 매개변수·16GB, Llama 4 Scout는 1,090억 매개변수·218GB |
| KV 캐시 사전 할당의 제약 | 원문이 제시한 Llama 3 최대 문맥 128K 토큰을 요청마다 미리 할당하면 H100에서 병렬 요청 4개로 제한 |
{{% /details %}}
