'use strict';

/** Sayfa bağlamında çalışır; çizim alanı mousedown'da odağın değişmesini engeller. */
function installDimensionCommit() {
  const dimensionIds = ['htmlctrl_width', 'htmlctrl_height'];
  const formatDimension = (input) => {
    if (!dimensionIds.includes(input.id) || !input.value.trim()) return;
    const value = Number(input.value);
    if (Number.isFinite(value)) input.value = String(Number(value.toFixed(2)));
  };
  // Editör ölçüleri getBBox ile okuyup jQuery.val ile yazar. Yalnızca alanın
  // gösterimini düzelt; SVG geometrisini veya kullanıcının yazdığı ara değeri değiştirme.
  const timer = setInterval(() => {
    const $ = window.jQuery;
    if (!$ || !$.fn) return;
    clearInterval(timer);
    const originalVal = $.fn.val;
    $.fn.val = function (...args) {
      const result = originalVal.apply(this, args);
      if (args.length) this.each(function () { formatDimension(this); });
      return result;
    };
    for (const id of dimensionIds) {
      const input = document.getElementById(id);
      if (input) formatDimension(input);
    }
  }, 200);
  window.__fxw.commitDimensions = () => {
    const input = document.activeElement;
    if (!input || !dimensionIds.includes(input.id)) return;
    const value = Number(input.value);
    if (!input.value.trim() || !Number.isFinite(value) || value <= 0 || !window.jQuery) return;
    // Editörün kendi değişiklik yolu çocuk SVG öğelerini ve geri alma geçmişini günceller.
    window.jQuery(input).trigger('change');
  };
  document.addEventListener('mousedown', (event) => {
    if (event.target !== document.activeElement) window.__fxw.commitDimensions();
  }, true);
}

module.exports = { installDimensionCommit };
