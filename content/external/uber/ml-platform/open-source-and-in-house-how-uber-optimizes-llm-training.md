---
title: "GPU 메모리부터 줄인 Uber Michelangelo의 LLM 학습"
description: "Uber는 LLM 학습에서 GPU 메모리를 아껴 배치를 키우는 방식으로 처리량을 높였습니다. CPU 오프로드와 flash attention의 효과가 Llama 2 70B와 7B에서 달랐던 이유를 Michelangelo의 실험 결과로 설명합니다."
date: 2026-11-10
weight: 2
---

# GPU 메모리부터 줄인 Uber Michelangelo의 LLM 학습 (2026-04)

{{< callout type="info" >}}
**원문 정보**
- 원문: [Open Source and In-House: How Uber Optimizes LLM Training](https://www.uber.com/us/en/blog/open-source-and-in-house-how-uber-optimizes-llm-training/)
- 매체 · 게시일: Uber Engineering Blog · 2026-04-15
- 저자: Bo Ling(Senior Staff Engineer), Jiapei Huang, Baojun Liu, Chongxiao Cao(Senior Software Engineer), Anant Vyas(Senior Staff Engineer), Peng Zhang(Engineering Manager)
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## Uber Eats의 지식을 배운 오픈소스 모델 {#background}

Uber Eats에서는 메뉴와 음식, 식당에 관한 지식으로 모델을 미세조정하자 아이템 태깅과 검색어·사용자 선호 이해가 오픈소스 기본 모델보다 나아졌습니다. 이런 모델은 GPT-4에 가까운 성능을 내면서 Uber 규모의 트래픽을 훨씬 더 많이 처리할 수 있습니다. 사내 학습을 뒷받침하는 구체적인 성과입니다.

모든 용도에 같은 모델을 쓰지는 않습니다. Uber는 추천과 검색부터 고객 지원 챗봇, 코드 개발, SQL 생성까지 생성형 AI를 활용하며, Meta Llama 2와 Mistral AI Mixtral 같은 오픈소스 모델을 OpenAI, Google 등의 비공개 모델과 함께 씁니다. 도메인 지식을 반영하는 방법도 용도에 따라 선택합니다. RAG로 외부 지식을 제공하기도 하고, 지속적 사전학습과 지시어 미세조정으로 모델 자체를 학습시키기도 합니다.

## 더 낮은 학습 손실을 위한 GPU 메모리 {#training-results}

학습을 맡은 플랫폼은 Michelangelo입니다. 전체 파라미터 미세조정부터 LoRA와 QLoRA 같은 파라미터 효율 미세조정까지, 가장 큰 오픈소스 LLM도 지원하는 것이 목표였습니다. 그런데 Llama 2 13B와 70B의 학습 손실 곡선에서 차이가 드러났습니다. LoRA와 QLoRA는 훨씬 적은 GPU로 더 빠르게 학습했지만, 손실은 전체 파라미터 학습만큼 내려가지 않았습니다. 전체 파라미터 미세조정을 더 빠르고 효율적으로 돌릴 이유가 여기에 있었습니다.

먼저 GPU 메모리를 아껴 봤습니다. 셀프 어텐션은 시간과 메모리 비용이 제곱으로 늘어나는 병목이어서, 메모리 사용량을 줄이면 배치를 더 키울 여지가 생깁니다.

DeepSpeed ZeRO-stage-3 CPU 옵티마이저 오프로드는 Llama 2 70B에서 같은 배치 크기로 쓰는 GPU 메모리를 최소 34% 줄였습니다. 확보한 공간으로 배치를 3~4배 키워도 순전파와 역전파 속도는 같았습니다. 한 번에 더 많은 데이터를 처리하면서 처리량은 2~3배로 늘었습니다.

Hugging Face가 권한 flash attention도 효과가 있었습니다. 같은 배치에서 GPU 메모리를 50% 아꼈고, 남은 메모리를 채우도록 배치를 두 배로 키워도 순전파와 역전파 속도는 비슷한 수준이었습니다.

## 70B와 7B에서 달랐던 Llama 2의 병목 {#model-bottlenecks}

메모리를 채웠다고 GPU의 연산 능력까지 다 쓴 것은 아닙니다. Uber는 이를 MFU(Model Flops Utilization)로 확인했습니다. 메모리나 통신 부담 없이 하드웨어가 최대 FLOPS로 동작할 때의 이론적 처리량과 실제 처리량을 비교하는 지표입니다. DeepSpeed Flops Profiler로 순전파·역전파의 GPU당 연산량을 구하고 반복 실행 시간으로 나눈 뒤, GPU의 이론적 최대 성능과 비교했습니다.

비교 조건은 메모리 한도였습니다. 각 설정에서 GPU 메모리를 최대한 쓰도록 배치를 키웠고, `gradient_accumulation_steps = 1`로 고정해 전체 배치 크기가 GPU당 배치 크기와 GPU 수의 곱이 되게 했습니다. Llama 2 70B는 GPU 32장, 즉 A100 8호스트 또는 H100 4호스트에서 학습했습니다. flash attention과 CPU 오프로드를 적용한 설정에서는 GPU 메모리를 70GB~80GB까지 쓰면서 배치를 2~7배 키울 수 있었습니다.

70B에서는 H100의 MFU가 A100보다 낮았습니다. 메모리를 한도까지 써도 GPU의 연산 능력을 충분히 활용하지 못했는데, 이는 연산보다 메모리에 묶여 있다는 신호로 해석했습니다. 이 실험에서 MFU를 가장 많이 높인 방법도 CPU 오프로드였습니다.

작은 모델에서는 결과가 달랐습니다. 호스트 하나의 A100 또는 H100 4장으로 학습한 Llama 2 7B는 70B보다 MFU가 높았고, 연산 성능의 제약을 더 많이 받는 것으로 보였습니다. CPU 오프로드는 도움이 되지 않았으며 flash attention이 가장 효과적이었습니다.

네트워크에는 아직 여유가 있었습니다. 70B 학습 중 사용량은 H100에서 초당 약 10GB, A100에서 약 3GB로 이론적 대역폭에 비해 작았습니다. 이 실험에서 네트워크는 병목이 아니었습니다.

## 여러 클러스터에 학습을 배치하는 Kubernetes {#infrastructure-stack}

이 실험을 받친 하드웨어는 온프레미스의 NVIDIA A100과 Google Cloud의 NVIDIA H100입니다. 모두 Crane 인프라 스택이 관리합니다. A100 호스트에는 GPU 4장, 메모리 600GB, SSD 3TB가 있고, Google Cloud의 3-highgpu-8g 호스트에는 H100 8장, CPU 메모리 1872GB, SSD 6TB가 있습니다.

학습 작업은 여러 Task를 묶은 Job으로 표현합니다. JobSpec에는 인스턴스 SKU와 클러스터, 컴퓨트·스토리지 자원뿐 아니라 컨테이너가 뜬 뒤 토큰과 환경 변수를 설정할 명령까지 적습니다. 연합 계층이 여러 Kubernetes 클러스터의 가용 자원을 보고 작업을 배치하면, Kubernetes가 학습 워크로드와 하드웨어 요구를 스케줄하고 Ray와 KubeRay 오퍼레이터가 워커에 작업을 나눕니다.

## Ray에서 NCCL까지 이어지는 Michelangelo {#training-stack}

Michelangelo의 학습 스택은 오픈소스로 채웠습니다. 가장 위에는 작업을 조율하는 Ray가, 가장 아래에는 GPU 간 통신을 맡은 NCCL이 있습니다. 그 사이에서 PyTorch가 학습을 실행하고, Ray Train이 얇은 API로 Ray 위의 PyTorch 분산 학습을 지원합니다. 대부분의 최신 오픈소스 LLM이 PyTorch로 구현돼 있다는 점이 프레임워크 선택의 이유였습니다. Hugging Face Transformers는 모델을 내려받고 학습하며, DeepSpeed는 규모와 속도를 최적화합니다.

작업이 시작되면 Ray Train의 TorchTrainer가 Ray Actor 형태로 워커를 만듭니다. Ray Object Store로 들어오는 통신을 처리하고, 모든 호스트에 걸쳐 DeepSpeed가 사용할 PyTorch 분산 프로세스 그룹을 초기화합니다. 데이터는 Uber HDFS, Terrablob, Hugging Face 공개 데이터셋에서 가져옵니다. 입력을 정수 토큰으로 바꾼 뒤 각 GPU 워커가 DeepSpeed ZeRO stage 1/2/3 옵션을 지정해 Hugging Face Transformers Trainer를 초기화하고 학습합니다.

결과를 남기는 경로도 정해져 있습니다. 실험 지표는 Uber Comet 서버에 기록하고, Ray 헤드 노드의 메인 학습 프로세스가 모델 가중치와 설정 파일을 Terrablob에 올립니다.

사내에서 직접 학습하되, 새 모델과 학습 기법은 오픈소스에서 가져오는 접근입니다. PyTorch FSDP, llama-recipes, LoRA, QLoRA, PEFT 같은 라이브러리와 도구도 실험과 미세조정의 부담을 덜어 줍니다. Uber는 이런 생태계를 활용해 최신 모델을 더 빠르고 저렴하며 안전하게 실험할 유연성을 얻었습니다. 오래 검증된 Ray와 Kubernetes가 이미 자리 잡고 있어 새 오픈소스 솔루션을 통합하기도 쉬웠습니다.

Falcon, Llama, Mixtral 같은 모델은 몇 달마다 새로 나왔습니다. Hugging Face 커뮤니티와 DeepSpeed를 빠르게 받아들이는 능력이 이런 변화에 대응하는 바탕이었습니다. Uber는 Llama 3 450B 같은 더 큰 오픈소스 모델이 나오면 미세조정을 지원하도록 인프라를 확장하고, 이를 Uber Eats의 추천과 검색 개선에 활용할 계획입니다.

## 대규모 평가를 맡은 LLM Scorer {#llm-scorer}

학습한 모델을 큰 데이터셋에서 평가할 도구도 만들었습니다. 오프라인 LLM Scorer는 원본 모델과 미세조정 모델을 모두 평가합니다. Kubernetes 위에 GPU를 여러 장 갖춘 인스턴스들로 Ray 클러스터를 구성하고, 데이터를 나눠 병렬로 점수를 매깁니다. 각 인스턴스에는 vLLM 같은 추론 서버를 띄웁니다. Ray job이 CPU와 GPU를 할당받아 모델을 내려받고 데이터셋을 rank별로 나누면, Ray ActorPool이 여러 Actor의 출력을 모읍니다.

배치 예측에서는 H100의 처리량 차이가 뚜렷했습니다. Mixtral 8x7b를 A100과 H100 두 장씩에서 입력 4K 토큰, 최대 출력 700토큰으로 실행했을 때, 양쪽 모두 배치 크기 64까지 초당 출력 토큰 수가 선형으로 늘었습니다. H100의 처리량은 A100의 3배였습니다. 이 벤치마크는 팀들이 모델 운영을 결정하고 자원을 계획하는 기준으로 쓰입니다.

{{% details title="하드웨어 사양과 실험 수치" closed="true" %}}

| 항목 | 값 |
|---|---|
| 온프레미스 A100 호스트 | A100 4장, 메모리 600GB, SSD 3TB |
| Google Cloud H100 호스트 | 3-highgpu-8g, H100 8장, CPU 메모리 1872GB, SSD 6TB |
| CPU 오프로드(ZeRO-3), Llama 2 70B | GPU 메모리 최소 34% 감소, 배치 3~4배, 처리량 2~3배 |
| flash attention | 같은 배치에서 GPU 메모리 50% 절감, 최대 사용 시 배치 2배 |
| 메모리 최대 사용 시 배치 확대 | 2~7배 (70GB~80GB, GPU 32장) |
| 네트워크 사용량, 70B | H100 약 10GB/s, A100 약 3GB/s |
| Mixtral 8x7b 배치 예측 | 입력 4K, 최대 출력 700토큰, 배치 64까지 선형, H100이 A100의 3배 |

{{% /details %}}
