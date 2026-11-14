---
title: "로봇을 위한 MLOps 엣지 파이프라인의 구성"
description: "자율주행 로봇 딜리의 엣지 디바이스에서 여러 모델이 센서 주기에 맞춰 동작하는지 검증하는 파이프라인을 소개합니다. Trtexec, TREx, Nsight Systems와 자체 개발한 Trt-Infersight를 Airflow DAG로 엮은 구성입니다."
date: 2026-11-14
weight: 2
---

# 로봇을 위한 MLOps 엣지 파이프라인의 구성 (2024-07)

{{< callout type="info" >}}
**원문 정보**
- 원문: [로봇을 위한 MLOps #2: 엣지 파이프라인의 구성](https://techblog.woowahan.com/17827/)
- 매체 · 게시일: 우아한형제들 기술블로그 · 2024-07-19
- 저자: 송통일
- 시리즈: 로봇을 위한 MLOps 2편. 원문은 1편 「Edge device와 K3s, Airflow」에서 GPU workstation과 엣지 디바이스에 워커 노드를 설치하고 Kubernetes와 Airflow로 전체 파이프라인을 돌리는 인프라를 다뤘다고 되짚습니다.
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 엣지 디바이스에서 AI 연산을 하는 이유 {#why-on-device}

자율주행 로봇 딜리(Dilly)에는 NVIDIA Jetson 플랫폼 기반의 임베디드 보드가 들어 있습니다. CPU와 GPU 외에 DLA(Deep Learning Accelerator), VIC, 하드웨어 인코더·디코더, 여러 센서 인터페이스가 한 보드에 들어 있고, 여기에 IMU, LiDAR, 카메라가 연결됩니다. 이 보드가 곧 엣지 디바이스입니다.

원문은 on-device AI가 자율주행에 필수인 이유를 셋으로 듭니다. 실제 주행 환경에서 실시간으로 반응해야 하므로 연산마다 서버와 무선 통신하면 지연이 생깁니다. 주행 중 통신이 끊겨도 멈추지 않아야 합니다. 민감한 개인 정보를 보호하는 데도 유리합니다.

엣지 디바이스는 비용, 전력, 무게, 부피에 제약이 있고 한 번 정하면 하드웨어를 바꾸기도 어렵습니다. 그래서 주어진 자원 안에서 단위 시간당 처리량을 높이고 각 모듈의 지연을 줄이는 일이 중요합니다. 엣지 파이프라인은 Airflow DAG 가운데 엣지 디바이스에서 도는 부분이며, 한정된 자원에서 여러 모델이 정해진 시간 안에 문제없이 동작하는지 점검하려고 만들었습니다. 앞단에서는 GPU 학습 서버가 학습, PTQ, QAT를 거쳐 ONNX 파일을 내보내고, 엣지 디바이스는 이를 TensorRT로 변환해 GPU나 DLA에서 추론하는 런타임 엔진으로 만듭니다.

## TensorRT와 NVIDIA 도구 {#tensorrt-tools}

TensorRT는 모델이 NVIDIA GPU에서 효율적으로 돌도록 만드는 SDK입니다. 최적화 단계에서 모델 파일을 읽어 accelerator(GPU, DLA)에서 돌도록 최적화하고 plan이라는 엔진으로 변환하며, 추론 단계에서 plan을 역직렬화해 TensorRT Runtime으로 실행합니다.

Trtexec는 TensorRT를 가장 쉽게 쓰는 CLI입니다. 디바이스에 최적화된 plan을 만들고, 그 plan의 추론 성능을 간단히 벤치마크합니다. `--fp16`, `--int8`로 정밀도를 낮춰 추론 시간을 줄이고, `--layerPrecisions`로 특정 레이어의 정밀도를 따로 지정할 수 있습니다. `--saveEngine`과 `--loadEngine`으로 plan을 저장하고 다시 불러오며, `--useDLACore`로 DLA를 쓰고 `--allowGPUFallback`으로 DLA가 지원하지 않는 레이어를 GPU에서 처리합니다. 추론 시간과 프로파일 결과는 JSON으로 내보낼 수 있습니다.

TREx(trt-engine-explorer)는 변환된 plan과 추론 중 생성물을 분석하는 Python 패키지로 Jupyter Notebook과 함께 씁니다. Netron으로는 TensorRT가 변환한 plan을 볼 수 없는데, TREx 스크립트로 plan을 그래프로 그릴 수 있습니다.

Nsight Systems는 CPU, GPU, DLA 등을 분석해 병목을 찾는 성능 분석 도구입니다. GUI를 켜면 약간의 오버헤드가 있어서, 원문은 `nsys` CLI로 프로파일링하고 결과(`.nsys-rep`)를 GUI에서 분석하는 방식이 편하다고 봅니다. 프로파일링은 관리자 권한으로 해야 시스템 전체 자원에 접근할 수 있고, 추적하는 자원이 많을수록 시스템 부하가 크므로 캡처 대상을 최소로 하고 필요하면 나눠서 프로파일링하길 권합니다.

## 자체 개발한 Trt-Infersight {#trt-infersight}

Trtexec는 단일 모델의 성능 프로파일링에 맞춰져 있습니다. 자율주행 로봇은 카메라, 라이다, 레이더 같은 여러 센서를 쓰고, 센서마다 주기적으로 들어오는 데이터에 맞는 모델을 돌려야 하므로 여러 모델의 추론이 동시에 일어납니다. 센서 입력 주기에 따른 지연 설정이나 여러 모델의 동기·비동기 추론을 Trtexec는 옵션으로 제공하지 않습니다. 프로파일링을 맞춤 설정하고 기능을 유연하게 확장하고 자율주행 관련 로직도 검증할 수 있는 도구가 필요해, TensorRT C++ API로 Trt-Infersight를 만들었고 이 글에서 처음 소개합니다.

동작 단계는 다음과 같습니다.

1. 모델 초기화. 입력 파일에 따라 설정하고 돌릴 모델의 인스턴스를 모두 만듭니다.
2. Deserialization과 탐색. 엔진을 역직렬화하고 모델의 input과 output 특성을 추출합니다. Input generator는 이 정보로 텐서를 만들고 적절한 범위의 임의 값을 채우며, 사용자가 input 파일을 주면 그 값을 씁니다.
3. 성능 프로파일러 생성. 설정 파일의 평가 옵션에 따라 만들어지고 추론 시간 측정과 시스템 성능 수집 결과를 report 인스턴스에 저장합니다.
4. 추론 실행과 스레드 관리. Executor가 모델에 설정된 accelerator(GPU, DLA)에 따라 서로 다른 스레드로 추론하고 모든 iteration이 끝나길 기다립니다.

모델이 둘 이상이면 설정에 따라 CUDA stream이 네 가지로 동작합니다. 동기 방식은 한 모델의 추론이 끝나면 다음 모델이 시작됩니다. 비동기 방식은 두 stream에서 동시에 추론합니다. 비동기에 iteration 대기를 더하면 매 iteration마다 모든 추론이 끝나길 기다린 뒤 넘어가고, 센서 input 주기까지 설정하면 매 iteration마다 모든 모델의 센서 주기가 끝나길 기다립니다. 한 GPU에서 추론을 병렬로 돌리면 처리량이 제한돼 각 추론이 길어질 수 있으므로, GPU와 DLA가 여럿이면 모델을 다른 accelerator에 나눠 배치하길 권합니다.

출력은 모델별 시간과 시스템 지표(GPU 점유, CPU 점유, 온도 등)를 담은 `profile_report.yaml`, `tegrastats`로 주기적으로 수집한 `system_profile.txt`, 이를 그린 `system_profile_graph.png`입니다.

## Airflow DAG로 엮은 엣지 파이프라인 {#airflow-dag}

파이프라인은 세 가지를 확인합니다. 학습된 모델이 엣지 디바이스에서 추론 가능한 plan으로 변환되는지(Trtexec)를 보며, 지원하지 않는 레이어가 있으면 제거하거나 custom operation 라이브러리를 만들어야 합니다. 여러 모델이 동작할 때 시스템 성능 요구 조건을 충족하는지 지표를 뽑고(Trt-Infersight), 프로파일링 뒤에는 변환된 엔진을 분석할 자료를 제공합니다(TREx, Nsight Systems).

구현은 각 단계를 KubernetesPodOperator로 정의한 Airflow DAG입니다. 작업이 엣지 디바이스에서만 돌도록 노드 어피니티로 엣지 노드를 지정하고, DAG 볼륨은 PVC로, Nsight 경로와 `/usr/bin`(tegra) 같은 호스트 경로는 hostPath로 마운트합니다. task 순서는 출력 디렉터리 생성, ONNX 디렉터리 준비, TensorRT 엔진 빌드, Trt-Infersight 실행, TREx 실행입니다.

원문은 이 DAG로 엣지 디바이스의 다중 모델 추론과 프로파일링을 자동화할 수 있고, GPU 서버의 학습 파이프라인과 연결하면 학습, 배포, 검증이 모두 자동인 MLOps 시스템을 구성할 수 있다고 정리합니다. 앞으로도 여러 모델이 딜리 안에서 잘 동작하도록 기술 개발을 이어 가겠다는 말로 맺습니다.

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
