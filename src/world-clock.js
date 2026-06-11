/* ───────────────────────────────────────────────────────────
   <zone-meta>  — city + UTC offset + day/night + diff-vs-home line
   <world-pair> — two zones with a time-difference marker
   Both rely on window.TZ (tz-util.js) and reuse <flip-clock> /
   <analog-clock> for the actual dials.
   ─────────────────────────────────────────────────────────── */
(function () {
  const FLIP_DARK = '--w:48px;--h:70px;--fs:56px;--gap-g:14px;--gap-d:5px;--card:#2b2d35;--card-hi:#3a3d47;--card-lo:#1f2128;--digit:#f5f3ee;--seam:rgba(0,0,0,.52);--shadow:0 8px 18px rgba(0,0,0,.35);--edge:rgba(255,255,255,.10)';
  const FLIP_LIGHT = '--w:48px;--h:70px;--fs:56px;--gap-g:14px;--gap-d:5px;--card:#f7f5f1;--card-hi:#ffffff;--card-lo:#ece9e3;--digit:#232220;--seam:rgba(0,0,0,.10);--shadow:0 10px 24px rgba(0,0,0,.26);--edge:rgba(35,34,32,.18)';

  // ── zone-meta ──────────────────────────────────────────────
  class ZoneMeta extends HTMLElement {
    connectedCallback() {
      if (!this._built) {
        this._built = true;
        const scheme = this.getAttribute('variant') || 'dark';
        this.classList.add('zone-meta', 'zm-' + scheme);
        if (this.hasAttribute('center')) this.classList.add('zm-center');
        this.tz = this.getAttribute('tz') || '';
        this.home = this.getAttribute('home') || '';
        this.homeLabel = this.getAttribute('home-label') || '';
        this.label = this.getAttribute('label') || '';
        this.lang = this.getAttribute('lang') || 'zh';
        this.showDiff = this.hasAttribute('diff');
        this.short = this.hasAttribute('short');

        this.head = document.createElement('div'); this.head.className = 'zm-head';
        this.cityEl = document.createElement('span'); this.cityEl.className = 'zm-city'; this.cityEl.textContent = this.label;
        this.offEl = document.createElement('span'); this.offEl.className = 'zm-off';
        this.dnEl = document.createElement('span'); this.dnEl.className = 'zm-dn';
        this.dnEl.innerHTML = '<i class="zm-dot"></i><span class="zm-dnt"></span>';
        this.head.appendChild(this.cityEl); this.head.appendChild(this.offEl); this.head.appendChild(this.dnEl);
        this.appendChild(this.head);
        if (this.showDiff) {
          this.diffEl = document.createElement('div'); this.diffEl.className = 'zm-diff';
          this.appendChild(this.diffEl);
        }
      }
      this._run();
    }
    disconnectedCallback() { clearInterval(this._iv); this._iv = null; }
    _run() {
      const upd = () => {
        const T = window.TZ; if (!T) return;
        this.offEl.textContent = T.offsetLabel(this.tz);
        const day = T.isDay(this.tz);
        this.dnEl.className = 'zm-dn ' + (day ? 'day' : 'night');
        this.dnEl.querySelector('.zm-dnt').textContent =
          this.lang === 'en' ? (day ? 'Day' : 'Night') : (day ? '白天' : '夜晚');
        if (this.diffEl) this.diffEl.textContent = T.diffText(this.tz, this.home, this.lang, this.homeLabel, this.short);
      };
      upd();
      clearInterval(this._iv);
      this._iv = setInterval(upd, 10000);
    }
  }

  // ── helpers to spawn a dial ────────────────────────────────
  function makeDial(type, scheme, tz, size) {
    if (type === 'analog') {
      const a = document.createElement('analog-clock');
      a.setAttribute('variant', scheme);
      a.setAttribute('seconds', '');
      if (tz) a.setAttribute('tz', tz);
      a.style.cssText = '--size:' + (size || 150) + 'px';
      return a;
    }
    // digital
    const f = document.createElement('flip-clock');
    f.setAttribute('variant', scheme === 'dark' ? 'classic' : 'minimal');
    f.setAttribute('fields', 'hm');
    if (tz) f.setAttribute('tz', tz);
    f.style.cssText = scheme === 'dark' ? FLIP_DARK : FLIP_LIGHT;
    return f;
  }

  // ── world-pair ─────────────────────────────────────────────
  class WorldPair extends HTMLElement {
    connectedCallback() {
      if (this._built) return;
      this._built = true;
      const scheme = this.getAttribute('variant') || 'dark';
      const layout = this.getAttribute('layout') || 'stack';
      const type = this.getAttribute('type') || 'digital';
      const lang = this.getAttribute('lang') || 'zh';
      this.classList.add('world-pair', layout === 'row' ? 'wp-row' : 'wp-stack');
      if (scheme === 'light') this.classList.add('wp-light');

      const aTz = this.getAttribute('a-tz') || '';
      const aLabel = this.getAttribute('a-label') || '';
      const bTz = this.getAttribute('b-tz') || '';
      const bLabel = this.getAttribute('b-label') || '';

      const meta = (tz, label, withDiff, center) => {
        const z = document.createElement('zone-meta');
        z.setAttribute('variant', scheme);
        z.setAttribute('tz', tz);
        z.setAttribute('label', label);
        z.setAttribute('lang', lang);
        if (center) z.setAttribute('center', '');
        if (withDiff) { z.setAttribute('diff', ''); z.setAttribute('home', aTz); z.setAttribute('home-label', aLabel); }
        return z;
      };

      const diffPill = () => {
        const p = document.createElement('div');
        p.className = 'wp-pill';
        const upd = () => {
          const T = window.TZ; if (!T) return;
          const d = (T.offsetMin(bTz) - T.offsetMin(aTz)) / 60;
          const a = Math.abs(d), num = Number.isInteger(a) ? a : a.toFixed(1);
          p.textContent = d === 0 ? '同步' : (d > 0 ? '+' : '\u2212') + num + 'h';
        };
        upd(); setInterval(upd, 10000);
        return p;
      };

      if (layout === 'row') {
        const colA = document.createElement('div'); colA.className = 'wp-zone';
        colA.appendChild(makeDial(type, scheme, aTz, 150));
        colA.appendChild(meta(aTz, aLabel, false, true));
        const mid = document.createElement('div'); mid.className = 'wp-mid';
        const l1 = document.createElement('div'); l1.className = 'wp-line-v';
        const l2 = document.createElement('div'); l2.className = 'wp-line-v';
        mid.appendChild(l1); mid.appendChild(diffPill()); mid.appendChild(l2);
        const colB = document.createElement('div'); colB.className = 'wp-zone';
        colB.appendChild(makeDial(type, scheme, bTz, 150));
        colB.appendChild(meta(bTz, bLabel, false, true));
        this.appendChild(colA); this.appendChild(mid); this.appendChild(colB);
      } else {
        const rowA = document.createElement('div'); rowA.className = 'wp-zone';
        rowA.appendChild(meta(aTz, aLabel, false, false));
        rowA.appendChild(makeDial(type, scheme, aTz, 132));
        const div = document.createElement('div'); div.className = 'wp-divider';
        div.appendChild(diffPill());
        const rowB = document.createElement('div'); rowB.className = 'wp-zone';
        rowB.appendChild(meta(bTz, bLabel, false, false));
        rowB.appendChild(makeDial(type, scheme, bTz, 132));
        this.appendChild(rowA); this.appendChild(div); this.appendChild(rowB);
      }
    }
  }

  if (!customElements.get('zone-meta')) customElements.define('zone-meta', ZoneMeta);
  if (!customElements.get('world-pair')) customElements.define('world-pair', WorldPair);
})();
