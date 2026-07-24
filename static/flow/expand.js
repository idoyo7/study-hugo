/* vm-flow/seq 공용 "크게 보기" — 도식을 전체화면 오버레이로 확대(화면 전체 사용).
   버튼 클릭으로 열고, Esc·바깥 클릭·닫기 버튼으로 닫는다. 확대 중에도 애니메이션 유지. */
(function () {
  'use strict';
  var EXP_ICON = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/></svg>';
  var cur = null;

  function openBox(b) { if (cur) closeBox(); cur = b; b.classList.add('is-expanded'); document.documentElement.classList.add('vm-expand-lock'); }
  function closeBox() { if (!cur) return; cur.classList.remove('is-expanded'); document.documentElement.classList.remove('vm-expand-lock'); cur = null; }

  function enhance(box) {
    if (box.dataset.vmxp) return; box.dataset.vmxp = '1';
    var exp = document.createElement('button');
    exp.className = 'vm-expand-btn'; exp.type = 'button'; exp.title = '크게 보기'; exp.setAttribute('aria-label', '크게 보기');
    exp.innerHTML = EXP_ICON;
    exp.addEventListener('click', function (e) { e.stopPropagation(); openBox(box); });
    box.appendChild(exp);

    var cl = document.createElement('button');
    cl.className = 'vm-expand-close'; cl.type = 'button'; cl.title = '닫기 (Esc)'; cl.setAttribute('aria-label', '닫기');
    cl.textContent = '✕';
    cl.addEventListener('click', function (e) { e.stopPropagation(); closeBox(); });
    box.appendChild(cl);

    // 확대 상태에서 바깥(패딩 영역) 클릭 시 닫기 (도식 자체 클릭은 유지)
    box.addEventListener('click', function (e) { if (box.classList.contains('is-expanded') && e.target === box) closeBox(); });
  }

  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && cur) closeBox(); });

  function init() {
    var l = document.querySelectorAll('.vm-flow, .vm-seq');
    for (var i = 0; i < l.length; i++) enhance(l[i]);
  }
  if (document.readyState !== 'loading') init();
  else document.addEventListener('DOMContentLoaded', init);
})();
