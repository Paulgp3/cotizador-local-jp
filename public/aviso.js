// public/aviso.js
(function () {
  function tryClose() {
    // 1) Cierre estándar (solo funciona si la ventana fue abierta por script)
    try { window.close(); } catch (_) {}

    // 2) Workaround Safari/iOS y algunos navegadores
    try { window.open('', '_self'); window.close(); } catch (_) {}

    // 3) Último recurso: regresar atrás si sigue abierta
    setTimeout(function () {
      try { history.back(); } catch (_){}
    }, 50);
  }

  var btn = document.getElementById('btnVolver');
  if (btn) btn.addEventListener('click', function (e) {
    e.preventDefault();
    tryClose();
  });

  // Tecla ESC también cierra
  document.addEventListener('keydown', function(ev){
    if (ev.key === 'Escape') tryClose();
  });
})();
