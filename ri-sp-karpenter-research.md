# RI + SP × EKS Karpenter 약정 전략 — 베이스 자료

> 시나리오: EKS 워커 노드를 Karpenter가 동적 스케일링. 야간 최저 ~10대, 피크 ~100대, 서울(ap-northeast-2).
> 질문: RI/SP 특성 비교, 야간 바닥 10대 기준 RI+SP 병행 성립 여부, coverage 90/100/110% 오버커밋의 수학적 정당성, Karpenter 아키텍처와의 궁합.
>
> 조사 방법: 5개 차원 병렬 조사(RI/SP/Karpenter/FinOps/Spot) → 차원별 load-bearing 주장 8개씩 AWS 1차 문서 대조 적대적 검증(전부 confirmed) → 서울 실측 요율 기반 수치 모델링(해석해 vs 1분 해상도 수치해 오차 0.00069, 최적점 브루트포스 64조합 전부 일치) → 완결성 비판(갭 5) → 보강 조사 2건. 조사 시점 2026-08-08.

---

## 1. 실측 요율 — 서울 ap-northeast-2, m7i.xlarge (Price List API, 2026-08-06/08 조회)

on-demand **$0.2478/hr** (Linux/Shared). SKU 직접 조회 + 정적 가격피드 + 3rd-party 3중 교차 확인.

| 플랜 | 유효 $/hr | 할인율 d | 한계 손익분기 U\*=1−d |
|---|---|---|---|
| Compute SP 1yr No-Upfront | 0.17750 | 28.37% | 71.63% |
| Compute SP 1yr Partial | 0.16905 | 31.78% | 68.22% |
| Compute SP 1yr All-Upfront | 0.16567 | 33.14% | 66.86% |
| Compute SP 3yr No-Upfront | 0.12953 | 47.73% | 52.27% |
| Compute SP 3yr All-Upfront | 0.11754 | 52.57% | 47.43% |
| EC2 Instance SP 1yr No-Upfront | 0.16207 | 34.60% | 65.40% |
| EC2 Instance SP 1yr Partial | 0.15435 | 37.71% | 62.29% |
| EC2 Instance SP 1yr All-Upfront | 0.15126 | 38.96% | 61.04% |
| EC2 Instance SP 3yr No-Upfront | 0.11193 | 54.83% | 45.17% |
| EC2 Instance SP 3yr All-Upfront | 0.09742 | 60.69% | 39.31% |
| Spot (가정 65% 할인) | 0.08673 | 65% | — |

**핵심 발견 2가지:**

- **Standard RI = EC2 Instance SP, Convertible RI = Compute SP** — 유효 시간당 요율이 소수점 5자리까지 동일(예: 3yr AU $0.09741/$0.09742, $0.11754/$0.11754). RI vs SP는 할인율 선택이 아니라 **유연성·탈출 옵션·용량 보장의 선택**이다.
- 흔히 인용되는 "Compute SP 66% / EC2 ISP 72%"는 **카탈로그 전체 최댓값**이지 서울 m7i 요율이 아니다(실측 52.57%/60.69%). 이 값으로 계산하면 최적 커밋이 체계적으로 과대 산출된다.

NPV 보정: 자본비용 8% 기준 CSP 3yr AU 실질 48.87%(≈3yr NU 47.73%와 동률), ESP 3yr AU 57.63%. **선납(All-Upfront)의 이점은 자본비용을 반영하면 대체로 환상.**

## 2. RI 메커니즘 (AWS 1차 문서 검증 완료)

- Standard 1yr 40%/3yr 60%(최대 72%), Convertible 1yr 31%/3yr 54%(최대 66%) — 마케팅 평균치.
- **Regional RI는 용량 미보장, Zonal RI만 AZ 용량 보장.** Zonal은 대신 size flexibility와 AZ 유연성을 잃는다.
- Instance size flexibility: **Linux/Unix + default tenancy + Regional RI** 조합에서만. GPU 계열·Windows·RHEL·SUSE·dedicated 제외. normalization factor로 작은 사이즈부터 순차 적용.
- 청구 적용 순서: **RI → EC2 Instance SP → Compute SP.** 이중과금·상호잠식 없음. 예외: Organization 내 연결 계정의 미사용 Zonal RI가 자기 Regional RI보다 먼저 적용.
- RI Marketplace: **Standard만 판매 가능**(Convertible 불가, volume discount 구매분 불가). 셀러 등록에 **미국 은행 계좌 필수** → 한국 법인엔 사실상 닫힌 탈출구. 수수료 12%, 생애 한도 $50,000/5,000건.
- Queued Purchase: Regional RI만, 최대 3년 전 예약 → laddering의 기술 기반.
- **AWS 공식 권고: "We recommend Savings Plans over Reserved Instances"** (ec2-reserved-instances.html 최상단 Important 박스 — 이 개요 페이지 한 곳에만 게재). re:Invent 2024 이후 신규 패밀리(trn2·i8g 등)는 RI 없이 SP 전용 출시 추세(Duckbill 관찰, 2차 출처).
- RI가 여전히 유일한 수단인 곳: **RDS·ElastiCache·OpenSearch·Redshift 등 데이터 계층** (SP 미커버).

## 3. SP 메커니즘 (AWS 1차 문서 검증 완료)

### 정산 단위 — 가장 중요한 사실

SP 커밋은 기간 총량이 아니라 **$/hr(할인가 기준) 시간 단위 약정**이다.

> "Each hour's commitment can only be used within that hour and **cannot be carried over**." — sp-applying.html

- 약정 기간 8,760h/yr 전부, 매시간 커밋액이 무조건 청구된다.
- 매시간 정산: 적격 사용량을 SP 요율로 환산해 커밋에서 차감 → 초과분은 on-demand 정가 → **미달분은 그 시간에 소멸**. 이월·월말 정산·피크 초과분과의 상계 없음.
- RI도 동일한 시간 단위 구조(예약 인스턴스가 안 떠 있어도 과금). 기간 총액 약정은 EDP/PPA 계열이지 SP/RI가 아니다.
- 이 규칙이 손익분기 공식 U\* = 1−d 의 존재 이유다.

### 적용 알고리즘·기타

- Compute SP: family/size/region/OS/tenancy 무관 + **Fargate/Lambda 포함**. EC2 ISP: family+region 고정, size/OS/tenancy 자유.
- SP 내부 적용: **할인율(%) 높은 사용량부터**, 동률이면 SP 요율 낮은 것부터.
- Organization 공유: 구매 계정 우선 → sharing 활성 시 잔여분 공유. 모드 3종(Organization-wide / Prioritized Group / Restricted Group, Cost Categories 기반).
- **Spot 사용량에는 SP/RI 미적용**, 커밋 소진에도 카운트 안 됨. SP는 capacity 미보장.
- 반품: 시간당 커밋 **$100 이하 + 구매 후 7일 + 동일 역월(UTC) + 관리계정당 연 10건** (2024-03 도입). 그 외 재판매·양도·취소 경로 없음.
- 자동 갱신 없음 — 만료 시 즉시 on-demand 복귀. Queued 구매(최대 3년 전) 필수 운영.
- EKS: 컨트롤 플레인 요금($0.10/hr)은 SP 미커버, 워커 EC2는 커버. EKS Auto Mode 관리 프리미엄(~12%)은 SP/RI 할인 대상 아님.
- coverage/utilization 정의(Cost Explorer): utilization = 커밋 중 소진 비율, coverage = 적격 사용량 중 SP 커버 비율(분모가 달라서 **coverage는 정의상 100% 상한** — "110% coverage"는 AWS 용어로 성립 불가).

## 4. Karpenter × 약정 (검증 완료)

### 구조적 사실

- **Karpenter 가격 모델은 RI/SP를 모른다** — on-demand 정가 + 실시간 spot 가격만 참조(#3860 closed). consolidation이 "약정에 덮인 노드"를 "정가 싼 미커버 노드"로 능동 교체하며 커버리지를 갉아먹는다.
- family 미고정 시 family-locked 약정(Standard RI/EC2 ISP) 커버리지는 통제 불능 — 권장 기본 requirements(`instance-category [c,m,r]` + `generation>2`)가 수십 개 family를 연다.
- **NodePool에 최소 노드 수 개념 없음**(limits는 순수 상한). 야간 10대는 워크로드 replica의 부산물 — replica 변경·bin-packing 개선으로 통보 없이 무너질 수 있는 기준선.
- v1.14(2026-07-11) feature gate: **ReservedCapacity만 Beta·기본 활성.** StaticCapacity(v1.8+, `spec.replicas`)·NodeOverlay·SpotToSpotConsolidation은 Alpha·기본 비활성.
- NodeOverlay(`priceAdjustment`)로 약정 할인을 주입할 수 있으나 **약정 용량 소진 개념이 없어** 초과분에도 할인을 가정한다(#2589 closed as not planned).
- weight는 보장이 아니라 선호 — weight 100 pool 용량 고갈 시 fallback 미작동 사례(#8885). Spot→OD fallback 노드는 capacity-type이 고정되어 spot 복귀 안 되는 버그(#8889).
- 리전 단위 SP를 멀티 클러스터가 나눠 쓸 때 Karpenter는 SP 실사용률을 볼 수 없다(#8173) → coverage 관리는 클러스터 밖(Cost Explorer)에서.

### 실전 패턴 (aws-samples/karpenter-blueprints `reserved-capacity`)

- **베이스라인 NodePool**: 약정이 덮는 family/type으로 requirements 고정 + `limits.cpu`를 약정 vCPU에 일치 + weight 높게 + `consolidationPolicy: WhenEmpty`(또는 야간 disruption budget 0).
- **버스트 NodePool**: spot 우선 다양화(`minValues`로 유연성 강제), weight 낮게. 약정 걸지 않음.
- **ODCR**: Karpenter가 프로토콜 차원에서 이해하는 유일한 약정. `capacityReservationSelectorTerms` + `capacity-type: reserved`, **reserved > spot > on-demand** 우선(near-0 가격 모델링). 과금: ODCR은 미사용에도 on-demand 요율 과금, **Compute SP·Regional RI 할인이 ODCR에 적용됨(zonal RI는 미적용)** → 용량 보장 = ODCR(용량층) + SP(할인층) 2층 구조가 정답.
- EKS Best Practices Guide 명문화: *"Consider using a Savings Plan for everything under the minimum, and spot for capacity that will not affect your application's availability."*
- 약정 도입/family 교체 시 기존 노드→reserved 이관은 in-place가 아니라 **노드 롤**(#7979) — PDB·배포 창 사전 확보.

## 5. 오버커밋의 수학과 모델링 결과

### 핵심 공식

- 한계 커밋 손익분기: 할인율 d의 약정 $1/hr 추가 시, 슬라이스 사용률 **U > 1−d** 면 이득.
- 따라서 최적 커밋 = **시간별 사용량 분포의 d-분위수**. 야간 바닥은 0th percentile이라 정의상 항상 최적점보다 한참 아래.
- ESR(FinOps 공식) = Utilization × Coverage × Discount.

### duty curve의 계단 구조 (이 시나리오의 지배 변수)

야간 바닥(N=7h) 10대, 피크 100대(H시간), 선형 램프. 바닥 바로 위 사용률 **U(10+) = (24−N)/24 = 17/24 = 70.83%** (H·주말계수와 무관한 구조 상수).

→ **바닥 위로 1대라도 약정할 가치 판정 기준: d > N/24 = 29.17%**

| 플랜 (실측 d) | 판정 | 최적 커밋 x\* |
|---|---|---|
| CSP 1yr NU (28.37%) | 문턱 미달 (−0.80pp) | **정확히 바닥 10대** |
| CSP 1yr AU (33.14%) | 초과 | 바닥의 178~270% |
| CSP 3yr NU (47.73%) | 초과 | 바닥의 395~900% (H=8: 54.5대) |
| ESP 3yr AU (60.69%) | 초과 | 바닥의 600~1000% (피크 전량이 최적인 조합도) |

**답은 연속이 아니라 이분(bimodal).** 야간 바닥이 6.81h 미만이면 1yr NU도 문턱을 넘어 x\*가 10→19로 점프하는 칼날 위 시나리오.

### 주요 수치 (H=8, W=1.0, 연간)

- 전량 OD $123,460. 바닥 10대만 CSP 3yr NU 약정 시 $113,100(최적 대비 **+8.62%**), 최적 54.5대 $104,125(**15.66% 절감**).
- 비용곡선은 최적점 근방 극도로 평탄: 40~70대 어디든 최적 대비 1% 이내. **정밀도가 아니라 방향이 문제.**
- 비대칭: 바닥 미달 1대 손실(~$616/yr)이 초과 1대 손실(~$20/yr)의 약 30배 → "최소 100%, 미달 금지"는 정당.
- 하방 리스크: 최적점 커밋 후 사용량 −30%까지 거의 무해, **−50%에서 ESR 음수 전환**(절벽). x\*=54.5 약정은 실제 피크가 45대(−55%)로 떨어질 때까지 전량 OD보다 유리.
- Spot 혼합: 버스트의 50%를 Spot으로 → **x\*_spot = (x\*_nospot + 바닥)/2** 정확 매핑(8개 플랜 오차 0). Spot 도입 시 커밋을 먼저 줄여야 한다.
- ESP vs CSP 역전점: m7i 계열 점유율 **f\* = 65.7%** 미만으로 떨어지면 ESP 3yr의 8.12pp 추가 할인이 낭비로 역전(H=8, 3yr AU).

### coverage 90/100/110% 관행 판정

- (a) **야간 바닥 대비**로 읽으면: 단위 자체가 틀림(±1대 차이가 총비용의 1% 미만). 단 "미달 금지" 원칙은 비대칭 때문에 정당.
- (b) **평균 사용량 대비**로 읽으면: 이 프로파일(left-skewed, median>mean)에서 110%가 수학적 최적점과 거의 일치 — 1−d 분위수 규칙의 경험적 재발견.
- (c) **총 on-demand 지출 대비**(AWS 정의)로 읽으면: 110%는 정의상 불가. 3yr 최적점의 coverage가 자연스럽게 **75.8%**에 착지 → 업계 통설 70~85%와 일치.
- 검증 결과 "90~110%"가 업계 표준 용어로 문서화된 곳은 없음(오히려 "바닥의 70~80%만" 같은 보수 권고가 흔함). 반드시 분모를 명시하고 쓸 것.
- 업계 벤치마크(ProsperOps 2025): ESR median 15%, 75th percentile 30%. 본 시나리오 최적 ESR 22.6%는 75th 근처.

## 6. 1yr 전제 + 노드 타입 통제 시나리오 (후속 검토)

질문: "idle 10대 RI + 나머지 최대 90대분 평균 SP"가 최적인가? → **아니오.**

| 구성 (전부 1yr, H=8) | 연간 비용 | 절감률 | 소진율 |
|---|---|---|---|
| 전량 on-demand | $123,460 | — | — |
| 제안: ESP NU 10 + CSP NU ~47대(델타 평균) | **$126,698** | **−2.62% (OD보다 비쌈)** | 67.9% |
| 제안 AU 버전 | $120,893 | +2.08% | 67.9% |
| 바닥만 ESP NU 10 | $115,950 | +6.08% | 100% |
| **1yr 최적: ESP AU 단일층 ~33대** | **$112,506** | **+8.87%** | 76.1% |
| (참고) CSP 3yr NU 최적 ~54대 | $104,125 | +15.66% | 68.6% |

- CSP 1yr NU(28.37%)는 계단 문턱(29.17%) 미달 → 바닥 위 모든 슬라이스가 손익분기 미달. 델타 평균(~47대)까지 밀면 층 전체로 **연 ~$10.7k 순손실**.
- "평균만큼 커밋"은 3yr 휴리스틱(d≈50% → 최적≈중앙값≈평균). 1yr 할인율에선 최적점이 평균보다 한참 아래.
- 1yr 2층 자유혼합 전수 탐색 결과: **CSP 최적 배분량 = 0** (ESP가 전 구간 더 깊음).
- **1yr 최적 셋팅**: 단일층 EC2 Instance SP 1yr을 바닥의 2~3배(AU ~33대/W=1.0, ~29대/W=0.6; NU ~23대)까지. Standard RI 대신 ESP를 쓰는 이유: 요율 동일 + family만 잠기고 **사이즈 자유**(Karpenter bin-packing 보존). zonal 용량 보장이 필요하면 그건 ODCR로.
- 단서: ESP 미소진은 조직 내 "서울 m7i 사용량"만 흡수 가능(CSP는 아무 컴퓨트나 흡수) → family 통제 자신 없으면 CSP 1yr AU ~19대의 소프트 버전(~6.2% 절감).
- 1yr 선택의 기회비용: 3yr CSP 최적 대비 **연 $7~8k**. 가장 확실한 바닥 10대만 3yr(ESP 3yr NU 54.83%)로 쪼개면 그 슬라이스에서 연 $4.4k 추가 회수.

## 7. 크리틱 갭 5 + 보강 조사 결과

1. **약정 분모는 클러스터가 아니라 payer 계정 전체.** SP/RI는 통합 결제 전체 공유 — 같은 payer 아래 다른 클러스터·비-Karpenter EC2·Fargate가 있으면 조직 합산 곡선이 평평해져 최적 커밋·하방 리스크가 달라진다. 흡수원이 크면 보수 권고를 수학적 최적점 쪽으로 올려도 됨.
2. **노드 수 바닥 ≠ 달러 바닥.** SP 단위는 $/hr, Karpenter는 야간에 가장 공격적으로 consolidation → 커밋 사이징은 Cost Explorer 시간 단위 on-demand 지출 곡선(60~90일)에서 달러 바닥을 읽을 것.
3. **세대 교체는 단가를 깎아주지 않는다 — 오히려 올린다.** 서울 실측: m6i→m7i→m8i 각 **+5%**, m7g→m8g **+10%**. 실질 단가 하락 레버는 **x86→Graviton 전환뿐**(동세대 15~19%, 그 폭도 gen8에서 축소 중). Graviton 전환 계획이 있으면 시간당 지출 11~19% 하락 → 커밋 미소진 압박 → 전환 계획만큼 커밋을 미리 낮출 것. Compute SP는 arm64 자동 커버(할인 유지). AWS의 가치 제안은 "절대 단가 인하"에서 "price-performance 개선"으로 이동(m8i: "up to 15% better price-performance").
4. **Convertible RI exchange의 옵션성은 약하다.** exchange해도 **term이 리셋되지 않고 원래 만료일 이전**("transfers the end date to the new reservation"). 리전 고정, Fargate/Lambda 미커버, Marketplace 재판매 불가. API 자동화는 가능(GetReservedInstancesExchangeQuote → Accept)하나, Compute SP는 애초에 겪지 않는 문제를 수동/도구로 해결하는 구조 → 동일 요율에서 **Compute SP 구조적 우위**.
5. **Compute SP 미소진분은 조직 내 다른 컴퓨트(타 리전 EC2·Fargate·Lambda)가 흡수** → 흡수원이 상시 존재하면 오버커밋의 "낭비"가 전액 손실이 아니게 되어 하방 곡선이 완만해진다.

## 8. SP 차감 기준 변경 이력 (Wayback Machine 스냅샷 대조로 확정)

**핵심 정산 메커니즘은 2019-11 출시 이후 불변.** RI→EC2 ISP→Compute SP 순서, 최고 할인율 우선 소진, 구매계정 우선 공유 문구는 2019-11-13 스냅샷(출시 1주일 후)부터 존재하고, 2020-08 스냅샷의 계산 예시(Scenario 1~5 달러 금액)는 2026-07-07 최신 스냅샷까지 한 글자도 안 바뀌었다.

- **"Each hour's commitment... cannot be carried over" Note는 2025년 3~5월 사이 신규 추가된 문구다.** 단, 규칙 변경이 아니라 명문화: ① 공식 doc-history에 미등재(AWS 스스로 기능 변경으로 취급 안 함) ② 2020년부터 있던 계산 예시가 이미 시간당 정산·비이월 산수를 전제 ③ FAQ 전 스냅샷(2019~2025)에 carry 관련 문구 부재 — 즉 개념은 $/hr 커밋 구조가 시작된 2019년부터 내재.
- 최근 2~3년의 실제 변경은 전부 주변부: 7일 반품(2024-03-20), Purchase Analyzer(2024-11-21), **RI/SP Group Sharing GA(2025-11-19** — Prioritized/Restricted 그룹 공유 옵션 추가, 기본 거동 유지**)**, **Database Savings Plans 출시(2025-12-02**, re:Invent 2025**)**, Purchase Analyzer target coverage(2026-06-08). 리셀러/MSP 계정 간 공유 금지(2025-06-01)는 3자 소스로만 확인(공식 URL 미확인) — 일반 고객 차감 알고리즘과 무관.
- 스냅샷 원본: 2019-11-13 / 2020-08-10 / 2021-11-24 / 2022-09-01 / 2023-08-10 / 2024-07-19 / 2025-03-11(문구 없음) / 2025-05-03(첫 등장) / 2026-07-07, web.archive.org의 sp-applying.html.

## 9. 권장 아키텍처 (3년 존속 가정 기본형)

```
[용량 보장층·선택]  야간 바닥 10대 → ODCR(AZ별) + Static Capacity NodePool(Alpha 감수 시)
                    또는 weight 높은 고정-family pool + limits.cpu 캡
[할인층·핵심]       Compute SP를 달러 바닥의 300~400% 수준으로
                    3yr(확실한 바닥 몫) + 1yr(윗 계단) laddering, No-Upfront 우선
[변동층]            버스트는 spot 우선 다양화 pool(약정 없음 — spot엔 SP 미적용)
                    바닥 자체를 spot에 두는 건 AWS 명시적 비권장
[가드레일]          절대 상한 = 최저 일일 피크(주말 60대면 60대)
                    사이징: Cost Explorer 시간 단위 OD 지출 + SP Purchase Analyzer
                    target coverage(2026-06 GA)로 역산 검증
                    만료 관리: Queued 구매 + 만기 분산(단일 약정 ≤ 총 커밋 40%)
```

체크리스트: ① 달러 바닥 실측(60~90일) ② 조직 합산 곡선 확인 ③ Graviton 로드맵 반영 ④ baseline pool consolidation 봉쇄 ⑤ Pending 알람 + coverage/utilization 대시보드 ⑥ 약정 도입일 = 노드 롤 발생일(PDB·배포 창).

## 부록 — 주요 출처

- 요율: AWS Price List API (pricing.us-east-1.amazonaws.com, ap-northeast-2 오퍼파일, publicationDate 2026-08-06)
- SP: docs.aws.amazon.com/savingsplans — plan-types, sp-applying, return-sp, sp-quotas, queued-sp-cart, ce-sp-usingPR/CR, sp-recommendations
- RI: docs.aws.amazon.com/AWSEC2 — apply_ri, reserved-instances-types, ri-market-general, capacity-reservations-pricing-billing, ri-convertible-exchange
- Karpenter: karpenter.sh — nodepools, disruption, nodeoverlays, odcrs, settings; aws/karpenter-provider-aws designs/odcr.md, issues #3860 #8885 #8889 #8173 #7979; kubernetes-sigs/karpenter designs/static-capacity.md, #2589
- 패턴: github.com/aws-samples/karpenter-blueprints (reserved-capacity), docs.aws.amazon.com/eks/latest/best-practices/cost-opt-compute
- FinOps: finops.org (rate-optimization, ESR), prosperops.com (break-even, 2025 benchmark), AWS decision guide (EC2 purchasing options, 2026-06-22)
