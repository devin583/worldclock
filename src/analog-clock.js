/* ───────────────────────────────────────────────────────────
   <analog-clock> and <dual-clock>.
   <analog-clock variant="dark|light" seconds>
   <dual-clock   variant="dark|light" hour12 meta="weekday,date" location lang>
   Both update smoothly via requestAnimationFrame.
   ─────────────────────────────────────────────────────────── */
(function () {
  const WD_ZH = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const WD_EN = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

  function buildFace(host, withSeconds) {
    host.classList.add('analog');
    for (let i = 0; i < 60; i++) {
      const t = document.createElement('div');
      t.className = 'ac-tick' + (i % 5 === 0 ? ' h' : '');
      t.style.transform = 'rotate(' + (i * 6) + 'deg)';
      host.appendChild(t);
    }
    const mk = (cls) => { const h = document.createElement('div'); h.className = 'ac-hand ' + cls; host.appendChild(h); return h; };
    const hour = mk('ac-hour');
    const minute = mk('ac-minute');
    const second = withSeconds ? mk('ac-second') : null;
    const cap = document.createElement('div'); cap.className = 'ac-cap'; host.appendChild(cap);
    return { hour, minute, second };
  }

  function tickFace(hands, tz) {
    const z = window.TZ ? window.TZ.parts(tz) : null;
    let hh, mm, ss, ms;
    if (z) { hh = z.h; mm = z.m; ss = z.s; ms = z.ms; }
    else { const n = new Date(); hh = n.getHours(); mm = n.getMinutes(); ss = n.getSeconds(); ms = n.getMilliseconds(); }
    const s = ss + ms / 1000;
    const m = mm + s / 60;
    const h = (hh % 12) + m / 60;
    hands.hour.style.transform = 'rotate(' + (h * 30) + 'deg)';
    hands.minute.style.transform = 'rotate(' + (m * 6) + 'deg)';
    if (hands.second) hands.second.style.transform = 'rotate(' + (s * 6) + 'deg)';
  }

  class AnalogClock extends HTMLElement {
    connectedCallback() {
      if (!this._built) {
        this._built = true;
        this.classList.add('ac-' + (this.getAttribute('variant') || 'dark'));
        this.tz = this.getAttribute('tz') || '';
        this._hands = buildFace(this, this.hasAttribute('seconds'));
      }
      this._run();
    }
    disconnectedCallback() { cancelAnimationFrame(this._raf); this._raf = null; }
    _run() {
      const loop = () => { tickFace(this._hands, this.tz); this._raf = requestAnimationFrame(loop); };
      cancelAnimationFrame(this._raf);
      loop();
    }
  }

  class DualClock extends HTMLElement {
    connectedCallback() {
      if (!this._built) {
        this._built = true;
        this.classList.add('dual', 'dl-' + (this.getAttribute('variant') || 'dark'));
        this.hour12 = this.hasAttribute('hour12');
        this.lang = this.getAttribute('lang') || 'zh';
        this.tz = this.getAttribute('tz') || '';
        this.metaTokens = (this.getAttribute('meta') || 'weekday,date').split(',').map((s) => s.trim()).filter(Boolean);
        this.locationText = this.getAttribute('location') || '';

        this.face = document.createElement('div');
        this.face.className = 'analog ac-' + (this.getAttribute('variant') || 'dark');
        this.appendChild(this.face);
        this._hands = buildFace(this.face, true);

        const read = document.createElement('div');
        read.className = 'dl-read';
        this.timeEl = document.createElement('div'); this.timeEl.className = 'dl-time';
        this.subEl = document.createElement('div'); this.subEl.className = 'dl-sub';
        read.appendChild(this.timeEl); read.appendChild(this.subEl);
        this.appendChild(read);
      }
      this._run();
    }
    disconnectedCallback() { cancelAnimationFrame(this._raf); this._raf = null; }
    _run() {
      const loop = () => {
        tickFace(this._hands, this.tz);
        const now = window.TZ ? window.TZ.parts(this.tz) : (() => { const n = new Date(); return { h: n.getHours(), m: n.getMinutes(), day: n.getDay(), date: n.getDate(), month: n.getMonth() + 1 }; })();
        let h = now.h;
        if (this.hour12) { h = h % 12 || 12; }
        const hh = String(h).padStart(2, '0');
        const mm = String(now.m).padStart(2, '0');
        const time = hh + ':' + mm;
        if (this._time !== time) { this._time = time; this.timeEl.textContent = time; }

        const wd = (this.lang === 'en' ? WD_EN : WD_ZH)[now.day];
        const dateStr = this.lang === 'en'
          ? ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][now.month - 1] + ' ' + now.date
          : now.month + '月' + now.date + '日';
        const parts = this.metaTokens.map((t) => t === 'weekday' ? wd : t === 'date' ? dateStr : t === 'location' ? this.locationText : '').filter(Boolean);
        const sub = parts.join('\u0001');
        if (this._sub !== sub) {
          this._sub = sub;
          this.subEl.innerHTML = parts.map((p) => '<span>' + p + '</span>').join(' <span class="dl-accent">·</span> ');
        }
        this._raf = requestAnimationFrame(loop);
      };
      cancelAnimationFrame(this._raf);
      loop();
    }
  }

  if (!customElements.get('analog-clock')) customElements.define('analog-clock', AnalogClock);
  if (!customElements.get('dual-clock')) customElements.define('dual-clock', DualClock);
})();
