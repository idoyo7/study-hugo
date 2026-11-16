---
title: "Workers AI와 AI Gateway가 함께 여는 모델 호출 경로"
description: "Workers AI의 추론 기록과 비용을 한곳에서 관리하려면 어떻게 해야 할까요? Cloudflare는 기본 gateway와 통합 청구를 제공하며, 제공자와 모델 선택까지 맡는 라우팅을 준비하고 있습니다."
date: 2026-11-16
weight: 3
---

# Workers AI와 AI Gateway가 함께 여는 모델 호출 경로 (2026-08)

{{< callout type="info" >}}
**원문 정보**
- 원문: [Unifying Workers AI and AI Gateway into a single AI control plane](https://blog.cloudflare.com/workers-ai-gateway-unification)
- 매체 · 게시일: The Cloudflare Blog · 2026-08-07
- 저자: Michelle Chen, Ming Lu
- 원문 내용을 바탕으로 재구성한 요약입니다.
{{< /callout >}}

## 첫 호출부터 기록이 남는 default gateway {#automatic-inference-observability}

Workers AI를 직접 호출하던 `env.AI.run(...)`에 세 번째 인자로 `{ gateway: { id: 'default' } }`를 추가하면 요청이 AI Gateway를 거칩니다. gateway를 미리 만들어 둘 필요도 없습니다. gateway를 설정한 적이 없는 사용자가 `default`를 지정하면, AI Gateway가 첫 인증 요청에서 기본 gateway를 자동으로 생성합니다.

별도의 대시보드 설정 없이 요청과 응답의 전체 페이로드를 기록하고, 모델별 토큰 수와 비용 귀속 정보를 추적하는 경로입니다. AI Gateway 대시보드에서는 지연 시간 세부 내역과 토큰 사용량, 오류율은 물론 실제 프롬프트와 응답까지 확인합니다. 모델 동작을 디버깅하거나 AI 출력을 감사하는 팀에게는 앞이 보이지 않는 채 비행하던 상태에서 벗어나는 변화입니다.

기본 gateway로 시작했다고 계속 그 설정에 머물러야 하는 것은 아닙니다. 사용자 지정 캐시 규칙이 필요하거나 애플리케이션별로 트래픽을 나누고 싶어지면 이름이 있는 gateway를 만들면 됩니다. 이후 요청의 gateway 지정값 하나를 바꾸면 새 gateway로 전환합니다.

## 하나의 호출 경로에서 만난 Workers AI와 AI Gateway {#converging-control-plane}

이처럼 호출 옵션 하나로 연결되는 제품이지만 출발점은 달랐습니다. AI Gateway는 여러 모델 제공자에게 요청을 프록시하면서 관측, 로깅, 접근 제어, 보안을 제공합니다. Workers AI는 Cloudflare가 관리하는 GPU 인프라에서 모델을 호스팅하고 추론 API를 제공하는 서비스입니다.

Cloudflare가 지켜본 사용자의 목적은 서로 닮아 있었습니다. 내부 설계가 달라도 사용자는 모델에 연결하고 그 호출을 관리하려 했습니다. 그래서 Workers AI를 포함한 여러 제공자를 한 경로로 호출하고, 관측과 청구, 보안, 로깅을 하나의 제어 평면에서 관리하는 방향으로 제품을 통합하고 있습니다.

Workers의 AI binding은 이미 공통 진입점입니다. AI Gateway용과 Workers AI용 binding을 따로 고르지 않고 같은 `env.AI.run(...)`을 사용합니다. Cloudflare는 Workers AI를 AI Gateway 경유로 호출하는 `/ai/` REST API도 발표했습니다. REST API에서는 `cf-aig-gateway-id` 헤더에 `default`를 지정해 기본 gateway를 사용합니다.

어느 제품부터 써야 할지 결정한 뒤 다른 제품을 연결하는 과정을 줄이려는 변화입니다. 몇 달 앞서 도입한 기본 gateway도 이 방향에 맞춰, gateway를 설정한 적 없는 사용자에게 관측과 로깅을 제공하는 출발점이 됐습니다.

## Workers AI까지 넓어진 크레딧 지갑 {#unified-credit-billing}

호출 경로에 이어 청구도 합쳐집니다. 이전에는 AI Gateway 지갑에 크레딧을 충전해도 OpenAI, Anthropic 같은 외부 모델 제공자에게만 쓸 수 있었습니다. Cloudflare는 2026-08-07 발표에서 Workers AI 사용량도 같은 크레딧으로 결제하도록 지원했습니다.

이제 하나의 지갑을 채워 두고 OpenAI, Anthropic, Workers AI를 비롯한 지원 제공자에 나누어 쓸 수 있습니다. Workers AI에도 선불로 결제하는 경로가 생긴 것입니다.

Cloudflare는 이 경로의 사용을 장려하기 위해 AI Gateway 통합 청구를 사용하는 Workers AI 모델에 더 높은 요청 한도를 제공합니다. 통합 청구 사용이 적용 조건입니다. 발표에는 구체적인 한도 수치가 없으며, 최신 한도와 상향 요청 방법은 개발자 문서에서 확인하도록 안내합니다.

## 제공자 선택을 맡기는 모델 중심 라우팅 {#model-first-routing}

지금은 모델을 호출하려면 어느 제공자가 그 모델을 호스팅하는지 알아야 합니다. 그 제공자가 중단되거나 요청 한도에 걸리면 애플리케이션도 동작하지 못합니다. Cloudflare가 다음으로 준비하는 모델 중심 라우팅은 사용자가 원하는 모델을 지정하고, 제어 평면이 제공자 선택과 장애 조치, 부하 분산을 처리하는 방식입니다.

Kimi K2.7 Code를 요청하는 상황이 예입니다. 사용자에게 필요한 것은 그 모델의 응답이며, 제공자는 Workers AI일 수도, Moonshot의 API일 수도, 같은 가중치를 호스팅하는 다른 제공자일 수도 있습니다. Workers AI에 여유 용량이 있으면 Cloudflare의 관리형 인프라를 사용하고, 용량이 차면 gateway가 같은 모델을 제공하는 다른 곳으로 요청을 분산하는 구상입니다.

제공자 한 곳의 모델에 문제가 생겨도 애플리케이션에서 재시도하거나 Workers에 복잡한 대체 경로 로직을 작성하지 않고 트래픽을 옮기는 것이 목표입니다. 모델의 가용성을 gateway가 처리할 라우팅 문제로 보는 것입니다. 특정 제공자만 사용하도록 고정하는 선택지도 유지할 계획입니다.

Cloudflare는 검증된 제공자와 협력해 모델 출력 품질을 우선하고, Zero Data Retention(ZDR) 같은 요구사항도 준수할 수 있게 할 예정입니다. 게시 당시에는 아직 출시한 기능이 아니었습니다. 앞으로 몇 달 안에 AI Gateway와 Workers AI 사용자를 대상으로 시범 운영하기를 기대한다고 밝혔습니다.

## 모델 선택까지 맡길 지능형 라우팅 {#intelligent-model-routing}

모델 중심 라우팅에서도 사용자는 모델 이름을 골라야 합니다. 그다음으로 개발 중인 지능형 라우팅은 그 선택까지 gateway에 맡기는 기능입니다. 장애가 난 제공자를 바꾸는 데서 더 나아가, 요청에 맞는 모델 자체를 고르려는 것입니다.

설계상 Workers AI에서 실행되는 분류기가 프롬프트를 읽고 코딩, 조사, 요약, 일반 질의응답 등의 작업 유형을 예측합니다. 작업의 복잡도와 문맥이 얼마나 중요한지도 판단 대상입니다. 이어 휴리스틱 점수 산정기가 이 결과를 바탕으로 선별된 모델 후보군에서 가장 적합한 모델을 고릅니다.

정확한 모델을 직접 지정하는 선택지도 남겨 둘 예정입니다. 선택을 맡기는 사용자에게는 별도 설정이나 자체 라우팅 로직 없이 비용 효율과 성능을 개선하는 것이 목표입니다.

게시 당시 지능형 라우팅은 내부 시범 운영 중이었습니다. Cloudflare는 출시 전에 앞으로 몇 주 동안 테스트와 개선을 이어갈 계획이라고 설명했습니다. 이 발표에는 비용이나 성능이 얼마나 나아졌는지 보여 주는 실측 수치가 없습니다.

{{% details title="호출 경로와 gateway 설정값" closed="true" %}}
| 항목 | 값 |
|---|---|
| 공통 Workers binding | `env.AI.run(...)` |
| binding의 gateway 지정 | 세 번째 인자에 `{ gateway: { id: 'default' } }` 전달 |
| 통합 REST API 진입점 | `/ai/` |
| REST API의 gateway 지정 헤더 | `cf-aig-gateway-id` |
| 기본 gateway ID | `default` |
| 기본 gateway 자동 생성 조건 | gateway를 설정한 적이 없는 이용자가 기본 ID를 지정한 첫 인증 요청 |
| 사용자 지정 gateway 전환 | 이름이 있는 gateway를 생성한 뒤 요청의 gateway 지정값 변경 |
| Workers AI의 높은 요청 한도 적용 조건 | AI Gateway 통합 청구 사용 |
{{% /details %}}
