---
title: "오픈소스와 자체 인프라로 최적화한 Uber의 LLM 학습"
description: "Uber가 Michelangelo 플랫폼 위에 Ray, DeepSpeed, Hugging Face를 얹어 오픈소스 LLM을 직접 학습하고 평가하는 인프라를 정리한 글입니다. CPU 오프로드와 flash attention으로 처리량과 MFU를 높인 실험 결과를 요약합니다."
date: 2026-11-10
weight: 2
---

# 오픈소스와 자체 인프라로 최적화한 Uber의 LLM 학습 (2026-04)

{{< callout type="info" >}}
**원문 정보**
- 원문: [Open Source and In-House: How Uber Optimizes LLM Training](https://www.uber.com/us/en/blog/open-source-and-in-house-how-uber-optimizes-llm-training/)
- 매체 · 게시일: Uber Engineering Blog · 2026-04-15
- 저자: Bo Ling(Senior Staff Engineer), Jiapei Huang, Baojun Liu, Chongxiao Cao(Senior Software Engineer), Anant Vyas(Senior Staff Engineer), Peng Zhang(Engineering Manager)
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 사내 LLM 학습이 필요한 이유 {#background}

Uber에서 생성형 AI는 Uber Eats의 추천과 검색, 고객 지원 챗봇, 코드 개발, SQL 쿼리 생성에 쓰입니다. 모델은 Meta Llama 2나 Mistral AI Mixtral 같은 오픈소스와 OpenAI, Google 등의 상용 모델을 함께 씁니다. Uber의 도메인 지식은 RAG로 넣기도 하고, 지속적 사전학습과 지시어 미세조정으로 모델에 직접 입히기도 합니다.

Uber Eats에서는 메뉴, 음식, 식당에 대한 Uber의 지식으로 미세조정한 모델이 오픈소스 모델보다 아이템 태깅, 검색어, 사용자 선호 이해에서 정확했습니다. GPT-4와 비슷한 성능을 내면서 Uber 규모의 트래픽을 훨씬 더 받아 낼 수 있다고 합니다. transformers, DeepSpeed, PyTorch FSDP 같은 라이브러리와 llama-recipes, LoRA, QLoRA, PEFT 같은 도구가 인프라 구축과 미세조정의 부담을 덜어 줍니다. 원문이 말하는 사내 학습의 이점은 최신 오픈소스 모델로 더 빠르고 싸고 안전하게 실험할 수 있다는 것입니다.

## 인프라 스택 {#infrastructure-stack}

스택은 세 층입니다. 하드웨어 층에서는 온프레미스 NVIDIA A100 인스턴스와 Google Cloud의 NVIDIA H100 인스턴스에 워크플로가 올라가고, 두 쪽 모두 Crane 인프라 스택이 관리합니다. 오케스트레이션 층에서는 Kubernetes가 학습 워크로드와 하드웨어 요구를 스케줄하고, Ray와 KubeRay 오퍼레이터가 작업을 워커에 분배합니다. 연합 층은 여러 Kubernetes 클러스터를 묶어 자원 가용성에 따라 워크로드를 배치합니다. 학습 작업은 여러 Task를 가진 Job으로 모델링하고, JobSpec에 인스턴스 SKU, 클러스터, 컴퓨트와 스토리지 자원, 컨테이너 기동 뒤 토큰과 환경 변수를 설정하는 명령을 적습니다.

## 학습 스택과 분산 학습 파이프라인 {#training-stack}

학습 스택은 오픈소스로 채웠습니다. 대부분의 최신 오픈소스 LLM과 기법이 PyTorch로 구현돼 있어 프레임워크는 PyTorch로 정했습니다. Ray Train이 Ray 클러스터에서 PyTorch 분산 학습을 얇은 API로 맡고, Hugging Face Transformers가 모델 내려받기와 학습을, DeepSpeed가 규모와 속도 최적화를 담당합니다. 그림으로 보면 맨 위에서 Ray가 작업을 조율하고, 맨 아래에서 NCCL이 GPU 간 통신을 맡습니다.

분산 학습 파이프라인은 네 단계입니다.

- 멀티 호스트 통신: Ray Train의 TorchTrainer가 Ray Actor 형태의 워커를 여럿 만들고, 모든 호스트의 GPU에서 DeepSpeed가 쓰는 PyTorch 분산 프로세스 그룹을 초기화합니다.
- 데이터 준비: Uber HDFS, Terrablob, Hugging Face 공개 데이터셋을 원격 소스로 지원합니다.
- 모델 학습: 입력을 토큰화한 뒤, 각 GPU 워커가 DeepSpeed ZeRO stage 1/2/3 옵션으로 Hugging Face Trainer를 초기화합니다.
- 결과 저장: 실험 지표는 Uber Comet 서버에, 모델 가중치와 설정 파일은 Ray 헤드 노드의 메인 학습 프로세스가 Terrablob에 올립니다.

## 학습 결과 {#training-results}

Michelangelo는 전체 파라미터 미세조정과 LoRA, QLoRA 같은 파라미터 효율 미세조정을 가리지 않고 가장 큰 오픈소스 LLM까지 학습할 수 있었습니다. Llama 2 13B와 70B의 학습 손실 곡선을 보면, LoRA와 QLoRA는 GPU를 훨씬 적게 쓰고 빠르게 학습하지만 손실이 전체 파라미터 학습만큼 내려가지 않습니다. 그래서 전체 파라미터 미세조정의 처리량과 MFU를 높이는 일이 중요해졌습니다.

트랜스포머는 시간과 메모리가 제곱으로 느는 셀프 어텐션이 병목입니다. 처리량을 올리려고 GPU 메모리를 아끼는 두 방법을 써 봤습니다. 하나는 DeepSpeed ZeRO-stage-3 CPU 옵티마이저 오프로드로, Llama 2 70B에서 같은 배치 크기 기준 GPU 메모리를 최소 34% 줄였고 배치를 3~4배 키워도 순전파와 역전파 속도가 같아 처리량이 2~3배 올랐습니다. 다른 하나는 Hugging Face가 권한 flash attention으로, 같은 배치에서 메모리를 50% 아꼈고 메모리를 끝까지 쓰면 배치를 두 배로 키울 수 있었습니다.

효율은 MFU(Model Flops Utilization)로 쟀습니다. 하드웨어가 메모리나 통신 부담 없이 최대 FLOPS로 돌 때의 이론적 처리량 대비 실제 처리량의 비율입니다. DeepSpeed Flops Profiler로 GPU당 FLOPS를 구하고 장치의 이론 최대 성능으로 나눴으며, 모든 실험에서 GPU 메모리를 꽉 채우도록 배치를 키웠습니다.

실험에서 읽은 점은 다음과 같습니다.

- 처리량: Llama 2 70B를 32개 GPU(A100 8호스트, H100 4호스트)에서 메모리를 최대로 쓸 때 배치를 2~7배까지 키울 수 있었습니다.
- MFU와 병목: 70B에서는 H100의 MFU가 A100보다 낮고 메모리를 최대로 써도 GPU 활용이 가득 차지 않았습니다. 연산 바운드가 아니라 메모리 바운드라는 신호일 수 있고, 그래서 CPU 오프로드가 MFU를 가장 많이 올렸습니다. 호스트 하나의 GPU 4장으로 돌린 Llama 2 7B는 연산 바운드에 가까워 MFU가 70B보다 높았고, CPU 오프로드는 도움이 안 됐으며 flash attention이 가장 효과적이었습니다.
- 네트워크: 70B 학습에서 네트워크 사용량은 H100에서 초당 약 10GB, A100에서 약 3GB로, 이론값에 비해 작아 아직 병목이 아닙니다.

## 오프라인 LLM 스코어러 {#llm-scorer}

원본 모델이나 미세조정 모델을 큰 데이터셋에서 평가하려고 오프라인 LLM 스코어러도 만들었습니다. Kubernetes 위에 GPU가 여러 장인 인스턴스를 여럿 띄워 Ray 클러스터를 만들고, 데이터를 나눠 병렬로 점수를 매깁니다. 각 인스턴스에서는 vLLM 같은 추론 서버가 돕니다. Ray job 하나가 CPU와 GPU를 할당받아 모델을 내려받고 데이터셋을 rank별로 나누며, Ray ActorPool이 여러 Actor의 출력을 모읍니다.

Mixtral 8x7b를 A100과 H100 두 장씩에서 입력 4K 토큰, 최대 출력 700토큰으로 배치 예측했더니, 배치 크기 64까지는 초당 출력 토큰 수가 선형으로 늘었습니다. H100의 처리량은 A100의 3배였습니다. 팀들이 운영 결정을 내리고 자원을 계획할 때 쓰는 기준 벤치마크입니다.

## 맺음과 교훈 {#conclusion}

Llama 3 450B 같은 더 큰 오픈소스 모델이 나오면 미세조정을 지원하도록 인프라를 키울 계획이고, 이렇게 얻은 모델로 Uber Eats의 추천과 검색을 개선할 생각입니다. 원문이 꼽은 교훈은 둘입니다. 하나는 생성형 AI 흐름을 따라잡는 열쇠가 오픈소스를 받아들이는 데 있다는 것입니다. Hugging Face 커뮤니티와 DeepSpeed 덕을 짧은 시간에 봤고, 몇 달마다 Falcon, Llama, Mixtral 같은 모델이 나왔습니다. 다른 하나는 오래 검증된 확장 가능한 클러스터 관리가 최신 흐름을 빨리 따라가는 데 필수라는 것입니다. 이미 자리 잡은 Ray와 Kubernetes 스택 덕에 새 오픈소스 솔루션을 운영에 쉽게 붙일 수 있었습니다.

{{% details title="원문의 하드웨어 사양과 실험 수치" closed="true" %}}

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
