// 사이드바 접기 버튼. 상태는 <html data-sb-off> 속성이 단일 원천이고
// localStorage "sb-off" 에 저장한다(첫 페인트 전 적용은 head-end.html 의 인라인 한 줄).
(function () {
  var btn = document.querySelector(".hextra-sidebar-collapse");
  if (!btn) return;
  var root = document.documentElement;
  var label = { off: btn.dataset.expand, on: btn.getAttribute("aria-label") };

  function sync() {
    var off = root.hasAttribute("data-sb-off");
    var text = off ? label.off : label.on;
    btn.setAttribute("aria-expanded", off ? "false" : "true");
    btn.setAttribute("aria-label", text);
    btn.title = text;
  }

  btn.addEventListener("click", function () {
    var off = root.toggleAttribute("data-sb-off");
    try {
      if (off) localStorage.setItem("sb-off", "1");
      else localStorage.removeItem("sb-off");
    } catch (e) {}
    sync();
  });
  sync();
})();
