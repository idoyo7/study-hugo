#!/usr/bin/env python3
"""content/**.md 의 최초·최종 커밋일을 data/pubdates.yaml 로 뽑는다.

왜 데이터 파일인가. datePublished 를 프런트매터에 박으면 186개 파일을 한 커밋에
건드리게 되고, 그 순간 enableGitInfo 가 읽는 .Lastmod 가 전부 그날로 리셋된다.
사이트맵 lastmod 187건이 같은 날짜가 되어 실제 수정 이력(7월 119건·8월 377건)이
사라진다. 콘텐츠를 건드리지 않고 발행일만 옆에 두면 두 신호가 다 살아남는다.

  datePublished ← 이 파일 (경로별 최초 커밋일)
  dateModified  ← enableGitInfo 가 주는 .Lastmod (파일별 실제 최종 커밋일)

최종 커밋일도 같이 적는 이유는 Hugo 의 GitInfo 가 한글 경로에서 비기 때문이다.
git 은 core.quotepath 가 기본값(true)이면 비ASCII 경로를 8진 이스케이프로 내보내고,
Hugo 는 그 문자열을 실제 파일과 매칭하지 못한다. 실측으로 valkey 섹션 5개 문서가
.Lastmod 를 못 받아 사이트맵 lastmod 가 186 중 181 건이었다.
`git config core.quotepath false` 로도 고쳐지지만 그건 로컬 설정이라 새로 클론하면
사라진다. 값을 저장소 안에 적어두면 클론 상태와 무관하게 같은 결과가 나온다.
정상 경로는 GitInfo 가 이기므로 이 값은 폴백으로만 쓰인다
(layouts/partials/utils/page-dates.html).

키는 Page.File.Path 와 같은 형식이다 — content/ 를 뗀 상대 경로.
layouts/partials/utils/page-dates.html 이 이 키로 조회한다.

새 문서를 추가한 뒤 다시 돌려라. 안 돌려도 빌드는 깨지지 않는다.
항목이 없는 문서는 page-dates.html 이 .Lastmod 로 폴백한다.

사용: python3 tools/gen-pubdates.py   (저장소 루트에서)
"""
import json
import os
import subprocess
import sys

CONTENT = "content"
OUT = os.path.join("data", "pubdates.yaml")


def git_first_seen():
    """경로별 최초·최종 커밋 날짜를 한 번의 로그 순회로 모은다.

    core.quotepath=false 가 필수다. 켜져 있으면 git 이 한글 경로를
    "content/valkey/00-\\353\\221\\220..." 처럼 8진 이스케이프로 내보내고,
    valkey 섹션 5개 문서가 통째로 매칭에서 빠진다.

    --reverse 로 오래된 순서라 setdefault 가 곧 '최초'가 된다.
    이름이 바뀐 파일(R)은 옛 경로의 날짜를 물려준다 — 경로가 바뀌었다고
    발행일이 오늘이 되면 안 된다.
    """
    out = subprocess.run(
        ["git", "-c", "core.quotepath=false", "log", "--reverse",
         "--format=@%aI", "--name-status", "--", CONTENT],
        capture_output=True, text=True, check=True,
    ).stdout

    first, last = {}, {}
    when = None
    for line in out.splitlines():
        if line.startswith("@"):
            when = line[1:]
            continue
        if not line.strip() or when is None:
            continue
        parts = line.split("\t")
        status = parts[0]
        if status.startswith("R") and len(parts) >= 3:
            old, new = parts[1], parts[2]
            first.setdefault(new, first.get(old, when))
            last[new] = when
        elif status[0] in ("A", "M") and len(parts) >= 2:
            first.setdefault(parts[1], when)
            last[parts[1]] = when
    return first, last


def existing_docs():
    for root, _, files in os.walk(CONTENT):
        for name in files:
            if name.endswith(".md"):
                yield os.path.join(root, name)


def main():
    if not os.path.isdir(CONTENT):
        sys.exit("저장소 루트에서 실행해라 — content/ 가 없다")

    first, last = git_first_seen()
    rows, missing = {}, []
    for path in sorted(existing_docs()):
        when = first.get(path)
        key = os.path.relpath(path, CONTENT)
        if when:
            rows[key] = (when, last.get(path, when))
        else:
            missing.append(key)

    os.makedirs("data", exist_ok=True)
    # JSON 문자열은 그대로 유효한 YAML 큰따옴표 스칼라다. 한글·공백·콜론이 섞인
    # 경로를 손으로 인용하다 깨뜨리는 것보다 json.dumps 에 맡기는 편이 안전하다.
    with open(OUT, "w", encoding="utf-8") as fh:
        fh.write("# 생성 파일 — 직접 고치지 마라. tools/gen-pubdates.py 가 만든다.\n")
        fh.write("# 키: content/ 를 뗀 상대 경로 (Page.File.Path).\n")
        fh.write("# published = 최초 커밋일, modified = 최종 커밋일. 둘 다 ISO 8601.\n")
        for key, (pub, mod) in rows.items():
            fh.write("%s:\n" % json.dumps(key, ensure_ascii=False))
            fh.write("  published: %s\n" % json.dumps(pub))
            fh.write("  modified: %s\n" % json.dumps(mod))

    print("%s — %d개 문서" % (OUT, len(rows)))
    if missing:
        print("git 이력 없음 %d개 (아직 커밋 안 된 문서다):" % len(missing))
        for key in missing:
            print("  ", key)


if __name__ == "__main__":
    main()
