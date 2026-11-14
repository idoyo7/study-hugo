---
title: "딜리의 다중 모델 추론을 검증하는 MLOps 엣지 파이프라인"
description: "여러 모델이 센서 주기에 맞춰 추론을 마치는지 Trt-Infersight로 검증합니다. 모델 변환과 성능 측정, 분석을 Airflow DAG로 연결한 딜리의 MLOps 엣지 파이프라인입니다."
date: 2026-11-14
weight: 2
---

# 딜리의 다중 모델 추론을 검증하는 MLOps 엣지 파이프라인 (2024-07)

{{< callout type="info" >}}
**원문 정보**
- 원문: [로봇을 위한 MLOps #2: 엣지 파이프라인의 구성](https://techblog.woowahan.com/17827/)
- 매체 · 게시일: 우아한형제들 기술블로그 · 2024-07-19
- 저자: 송통일
- 시리즈: 로봇을 위한 MLOps 2편. 원문은 1편 「Edge device와 K3s, Airflow」에서 GPU workstation과 엣지 디바이스에 워커 노드를 설치하고 Kubernetes와 Airflow로 전체 파이프라인을 돌리는 인프라를 다뤘다고 되짚습니다.
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 하드웨어를 늘리기 어려운 딜리 {#why-on-device}

자율주행 로봇에서는 모델 하나의 추론 속도만 재서는 충분하지 않습니다. 카메라, 라이다, 레이더 등 여러 센서가 저마다 주기적으로 데이터를 보내고, 로봇은 데이터가 들어올 때마다 알맞은 모델을 실행해야 합니다. 여러 모델의 추론이 겹치는 상황에서도 정해진 시간 안에 처리를 마쳐야 하는 것입니다.

연산 장소에도 제약이 있습니다. 매번 서버와 무선 통신하면 주행 환경에 반응하기까지 지연이 생기고, 통신이 잠시 끊겨도 로봇은 계속 작동해야 합니다. 로봇 안에서 AI 연산을 수행하는 on-device AI가 자율주행에 필수인 이유입니다. 민감한 개인 정보를 보호하는 데도 유리합니다.

딜리(Dilly)에서 이 연산을 맡는 엣지 디바이스는 NVIDIA Jetson 기반 임베디드 보드입니다. CPU와 GPU 외에 DLA(Deep Learning Accelerator), VIC, 하드웨어 인코더·디코더와 센서 인터페이스가 들어 있고, IMU, LiDAR, 카메라가 연결됩니다. 자원이 부족하다고 하드웨어를 쉽게 늘릴 수는 없습니다. 비용과 전력, 무게, 부피의 제약 안에서 하드웨어를 정하고 시스템을 설계한 뒤에는 변경도 어렵습니다.

이 조건에서 처리량을 높이고 각 모듈의 지연을 줄이려면, 여러 모델을 함께 실행했을 때의 성능을 확인해야 합니다. 이를 검증하는 엣지 파이프라인은 Airflow DAG 가운데 엣지 디바이스에서 실행되는 부분입니다.

## 단일 모델 벤치마크 너머의 Trt-Infersight {#trt-infersight}

Trtexec는 변환된 단일 모델의 성능을 빠르게 확인하기에 유용합니다. 하지만 센서 입력 주기에 따른 지연 설정이나 여러 모델의 동기·비동기 추론을 고려하는 옵션은 제공하지 않습니다. 딜리에 필요한 검증 조건을 그대로 표현하기에는 부족했습니다.

프로파일링을 원하는 방식으로 바꾸고 기능을 확장하며, 자율주행 관련 로직까지 검증할 도구도 필요했습니다. 이 요구를 채우려고 NVIDIA TensorRT C++ API로 만든 도구가 Trt-Infersight입니다. 원문에서 처음 공개한 자체 개발 도구입니다.

Trt-Infersight는 설정에 따라 모델들의 실행 순서와 대기 조건을 바꿉니다. 두 모델을 동기 방식으로 실행하는 예에서는 CUDA stream을 각각 만들되, 한 모델의 추론이 끝난 뒤 다음 모델을 시작합니다. 모든 모델이 한 번씩 추론하면 한 iteration이 끝납니다. 비동기 방식에서는 두 stream에서 추론을 병렬로 실행합니다.

여기에 iteration 대기를 설정하면 모든 모델의 추론이 끝나야 다음 iteration으로 넘어갑니다. 모델별 센서 입력 주기까지 설정한 경우에는 매 iteration마다 모든 모델의 센서 입력 주기가 끝날 때까지 기다립니다. 단일 모델을 쉬지 않고 반복 실행할 때와는 다른 조건을 시험하는 것입니다. 한 GPU에서 병렬 추론을 수행하면 제한된 처리량 때문에 각 추론 시간이 길어질 수 있으므로, GPU와 DLA가 여럿인 환경에서는 모델을 서로 다른 가속기에 나눠 배치하도록 권합니다.

실행 준비는 모델 인스턴스를 만들고 초기화하는 데서 시작합니다. 엔진을 역직렬화해 입력과 출력의 형태·포맷을 추출하면, Input generator가 텐서를 만들고 적절한 범위의 임의 값을 채웁니다. 입력 파일을 제공했다면 그 파일의 값을 사용합니다. 평가 옵션에 맞춰 생성한 프로파일러는 추론 시간과 시스템 성능을 수집해 report 인스턴스에 저장하고, Executor는 모델에 지정된 GPU·DLA에 따라 추론 스레드를 생성해 모든 iteration이 끝날 때까지 기다립니다.

측정 결과는 용도에 따라 나누어 남깁니다.

- `profile_report.yaml`: 모델별 추론 시간과 GPU 점유, CPU 점유, 온도 등 시스템 지표
- `system_profile.txt`: `tegrastats`로 일정 주기마다 수집한 시스템 성능 데이터
- `system_profile_graph.png`: 시간에 따른 시스템 성능 변화를 그린 그래프

## ONNX를 plan으로 바꾸는 TensorRT {#tensorrt-tools}

다중 모델을 검증하려면 먼저 각 모델이 엣지 디바이스에서 실행 가능한 엔진으로 변환되어야 합니다. 앞단의 GPU 학습 서버에서는 학습과 PTQ, QAT 등의 과정을 수행하고 ONNX 파일을 생성합니다. ONNX는 서로 다른 딥러닝 프레임워크에서도 모델을 해석할 수 있도록 만든 공유 포맷입니다.

엣지 디바이스에서는 NVIDIA의 SDK인 TensorRT가 이 모델을 GPU나 DLA에 맞게 최적화합니다. 그 결과가 plan이라는 엔진입니다. 추론할 때는 plan을 역직렬화하고 TensorRT Runtime으로 실행합니다. 지원하지 않는 레이어 때문에 변환하지 못한다면 해당 레이어를 제거하거나 custom operation 라이브러리를 만들어야 합니다.

이 변환과 단일 모델 벤치마크를 별도 애플리케이션 개발 없이 수행하는 CLI가 Trtexec입니다. `--fp16`, `--int8`로 정밀도를 낮춰 추론 시간을 줄이거나, `--layerPrecisions`로 특정 레이어의 정밀도를 지정할 수 있습니다. 일부 레이어는 높은 정밀도를 유지하고 나머지는 낮추는 식입니다. 생성한 plan은 `--saveEngine`으로 저장하고 `--loadEngine`으로 다시 불러오므로, 추론을 시험할 때마다 빌드를 반복하지 않아도 됩니다.

실행할 가속기도 지정합니다. `--useDLACore`로 DLA를 사용하고, DLA가 지원하지 않는 레이어는 `--allowGPUFallback`으로 GPU에서 처리하도록 설정할 수 있습니다. 추론 시간과 프로파일링 결과를 JSON으로 내보내면 이후 분석에 사용할 자료가 남습니다.

## 엔진과 실행 기록을 살피는 TREx와 Nsight Systems {#profiling-tools}

변환을 마쳤다면 엔진 내부와 실제 실행 과정을 살펴볼 차례입니다. Netron은 `.onnx` 같은 모델 파일의 레이어를 보여 주지만 TensorRT가 변환한 plan의 시각화는 지원하지 않습니다. 이때 사용하는 TREx(trt-engine-explorer)는 변환된 plan과 추론 과정의 생성물을 분석하는 Python 패키지입니다. Jupyter Notebook과 함께 사용할 수 있고, 스크립트로 plan의 레이어 구성을 그래프로 그려 초기 성능과 계층구조를 확인합니다.

실행 중 병목을 찾는 데는 Nsight Systems를 씁니다. CPU, GPU, DLA의 동작을 타임라인으로 보고 API 호출 스택과 통계도 분석합니다. GUI 실행에 약간의 오버헤드가 있어, 개발팀은 `nsys` CLI로 프로파일링한 뒤 `.nsys-rep` 결과를 GUI에서 읽는 방식을 편리하게 보았습니다.

측정 자체의 부하도 고려해야 합니다. 추적하는 자원이 많을수록 시스템 부하가 커지므로 캡처 대상을 최소로 하고, 필요하면 일부 자원을 따로 프로파일링하도록 권합니다. 시스템 전체 자원에 접근하려면 프로파일링을 관리자 권한으로 실행해야 합니다.

## 엣지 노드에서 이어지는 Airflow DAG {#airflow-dag}

모델 변환, 다중 모델 성능 측정, 분석 자료 생성은 Airflow DAG의 작업으로 연결합니다. Trtexec로 plan 변환 여부를 확인하고, Trt-Infersight로 여러 모델이 성능 요구 조건을 충족하는지 판단할 지표를 수집합니다. TREx와 Nsight Systems는 엔진과 실행 과정을 분석할 자료를 제공합니다.

각 작업은 KubernetesPodOperator로 정의해 Kubernetes 클러스터에서 실행합니다. 노드 어피니티로 엣지 노드를 지정해 실제 엣지 디바이스에서 작업이 돌도록 합니다. DAG 볼륨은 PVC로 연결하고, Nsight 경로와 `/usr/bin`의 tegra 도구를 사용하기 위한 호스트 경로는 hostPath로 마운트합니다.

작업은 출력 디렉터리 생성에서 시작해 ONNX 디렉터리 준비, TensorRT 엔진 빌드, Trt-Infersight 실행, TREx 실행 순서로 이어집니다. 이 DAG로 엣지 디바이스의 다중 모델 추론과 프로파일링을 자동화할 수 있습니다. 여기에 GPU 서버의 학습 파이프라인을 연결하면 모델 학습부터 배포, 검증까지 자동으로 수행하는 MLOps 시스템으로 확장할 수 있습니다.

{{% details title="도구 옵션과 DAG 설정" closed="true" %}}

| 항목 | 값 |
|---|---|
| 엣지 하드웨어 | NVIDIA Jetson 기반 임베디드 보드 (CPU, GPU, DLA, VIC) |
| Trtexec 예시 옵션 | --onnx, --buildOnly, --saveEngine, --int8, --profilingVerbosity=detailed |
| 정밀도 옵션 | --fp16, --int8, --layerPrecisions |
| 추론 반복 예 | --iterations=100, --warmUp=200 (ms) |
| Nsight 트레이스 | cuda, osrt, nvtx, cudnn, cudla, tegra-accelerators |
| Trt-Infersight 출력 | profile_report.yaml, system_profile.txt, system_profile_graph.png |
| DAG 이름과 주기 | edge_pipeline, 1일 |
| DAG task 순서 | make_output_dir, make_onnx_dir, build_trt_engine, run_trt_infersight, run_trex |

{{% /details %}}
