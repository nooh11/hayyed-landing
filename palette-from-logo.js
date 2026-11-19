/* سحب ألوان الشعار → ألوان ثيم جاهزة وآمنة التباين.
 * دالة نقية: تاخذ بكسلات RGBA وترجّع { primary, surface, accent, onSurface, onAccent, ... } أو null.
 * تشتغل في المتصفح (نموذج صفحة هيِّد) وفي Node / عقدة Code في n8n بدون أي مكتبة.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.hayyedPalette = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  // ---------- ألوان ----------
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const hex = c => '#' + c.map(v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('').toUpperCase();
  function rgb2hsl([r, g, b]) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
    if (mx === mn) return [0, 0, l];
    const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h * 60, s, l];
  }
  function hsl2rgb([h, s, l]) {
    h = ((h % 360) + 360) % 360 / 360;
    if (s === 0) return [l * 255, l * 255, l * 255];
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    const f = t => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
    return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
  }
  const lin = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const lum = c => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

  // حرّك لمعان اللون (مع الحفاظ على الصبغة) لين يوصل التباين المطلوب مقابل لون ثاني
  function ensureContrast(color, against, min) {
    if (contrast(color, against) >= min) return color;
    const [h, s, l] = rgb2hsl(color);
    const goLighter = lum(against) < 0.4; // الخلفية داكنة → فتّح، والعكس
    let ll = l;
    for (let i = 0; i < 60; i++) {
      ll = clamp(ll + (goLighter ? 0.015 : -0.015), 0, 1);
      const c = hsl2rgb([h, s, ll]);
      if (contrast(c, against) >= min) return c;
    }
    return goLighter ? [255, 255, 255] : [17, 17, 17];
  }

  // ---------- الاستخراج ----------
  /**
   * @param {Uint8ClampedArray|number[]} data  بكسلات RGBA
   * @param {{maxColors?:number}} [opt]
   * @returns {null|{primary:string,surface:string,accent:string,onSurface:string,onAccent:string,swatches:string[],monochrome:boolean}}
   */
  function paletteFromPixels(data, opt) {
    const buckets = new Map(); // مفتاح 4 بت لكل قناة
    let total = 0;
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3];
      if (a < 128) continue;            // شفاف
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const [, s, l] = rgb2hsl([r, g, b]);
      if (l > 0.92) continue; // أبيض/خلفية الصورة
      total++;
      const k = (r >> 4) << 8 | (g >> 4) << 4 | (b >> 4);
      const e = buckets.get(k) || { n: 0, r: 0, g: 0, b: 0 };
      e.n++; e.r += r; e.g += g; e.b += b;
      buckets.set(k, e);
    }
    if (total < 30) return null; // صورة فاضية أو كلها أبيض

    let cs = [...buckets.values()].map(e => {
      const c = [e.r / e.n, e.g / e.n, e.b / e.n];
      const [, s] = rgb2hsl(c);
      return { c, n: e.n, w: e.n * (1 + s * 1.5) }; // الألوان المشبعة تُفضّل (هي هوية الشعار)
    }).sort((a, b) => b.w - a.w);

    // دمج المتقاربة
    const merged = [];
    for (const x of cs) {
      const m = merged.find(y => dist(x.c, y.c) < 60);
      if (m) { const t = m.n + x.n; m.c = m.c.map((v, i) => (v * m.n + x.c[i] * x.n) / t); m.n = t; m.w += x.w; }
      else merged.push({ ...x });
    }
    merged.sort((a, b) => b.w - a.w);
    const sig = merged.filter(x => x.n / total >= 0.02).slice(0, (opt && opt.maxColors) || 4);
    if (!sig.length) return null;

    const swatches = sig.map(x => hex(x.c));
    const first = sig[0].c;
    // اللون الثاني: الأبعد عن الأول بين المهمين
    const second = sig.slice(1).sort((a, b) => dist(b.c, first) - dist(a.c, first))[0];
    const monochrome = !second || dist(second.c, first) < 90 || sig.every(x => rgb2hsl(x.c)[1] < 0.12);

    // سطح داكن من اللون الأساسي (لمعان ≤ 0.22)، الصبغة محفوظة
    let [h, s, l] = rgb2hsl(first);
    const surface = hsl2rgb([h, Math.min(s, 0.45), Math.min(l, 0.2)]);
    // لون التمييز: اللون الثاني، أو الأساسي نفسه مفتّح، أو ذهبي هيِّد الافتراضي لو الشعار رمادي
    let accent;
    if (!monochrome) accent = second.c;
    else if (s > 0.25) accent = hsl2rgb([h, clamp(s, 0.35, 0.85), 0.58]);
    else accent = [201, 162, 75]; // #C9A24B
    accent = ensureContrast(accent, surface, 4.5);

    const white = [247, 244, 239], ink = [17, 17, 17];
    const pick = bg => contrast(white, bg) >= contrast(ink, bg) ? white : ink;
    return {
      primary: hex(first), surface: hex(surface), accent: hex(accent),
      onSurface: hex(pick(surface)), onAccent: hex(pick(accent)),
      swatches, monochrome,
    };
  }

  // المتصفح فقط: ملف شعار → بكسلات مصغّرة → ألوان
  function paletteFromFile(file) {
    return new Promise(resolve => {
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => {
        try {
          const W = 96, ratio = (img.naturalHeight || W) / (img.naturalWidth || W) || 1;
          const cv = document.createElement('canvas'); cv.width = W; cv.height = Math.max(8, Math.round(W * ratio));
          const cx = cv.getContext('2d', { willReadFrequently: true });
          cx.drawImage(img, 0, 0, cv.width, cv.height);
          resolve(paletteFromPixels(cx.getImageData(0, 0, cv.width, cv.height).data));
        } catch (e) { resolve(null); } finally { URL.revokeObjectURL(url); }
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    });
  }

  // للتحقق في الخادم (workflow 10): نقبل فقط شكل الألوان المتوقع
  function validate(p) {
    const H = /^#[0-9A-F]{6}$/;
    if (!p || typeof p !== 'object') return null;
    const keys = ['primary', 'surface', 'accent', 'onSurface', 'onAccent'];
    if (!keys.every(k => H.test(String(p[k] || '')))) return null;
    const o = {}; keys.forEach(k => o[k] = p[k]);
    o.swatches = (Array.isArray(p.swatches) ? p.swatches : []).filter(x => H.test(String(x))).slice(0, 4);
    o.monochrome = !!p.monochrome;
    return o;
  }

  return { paletteFromPixels, paletteFromFile, validate, contrast: (a, b) => contrast(a, b) };
});
