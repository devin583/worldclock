/* ───────────────────────────────────────────────────────────
   <flip-clock> — a self-contained mechanical flip clock.
   Transparent background; only the cards render.

   Attributes:
     variant   classic | minimal | cute | glass   (look)
     fields    "hms" | "hm"                        (seconds on/off)
     hour12    present → 12-hour clock
     ampm      present → show AM/PM marker
     meta      comma list of: weekday, date, location  (top row order)
     location  text shown for the "location" meta token
     lang      "zh" (default) | "en"               (weekday/date wording)
   ─────────────────────────────────────────────────────────── */
(function () {
  const WD_ZH = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const WD_EN = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  function makeDigit() {
    const d = document.createElement('div');
    d.className = 'fc-digit';
    d.innerHTML =
      '<div class="fc-leaf fc-top fc-static-top"><span class="fc-n">0</span></div>' +
      '<div class="fc-leaf fc-bottom fc-static-bottom"><span class="fc-n">0</span></div>' +
      '<div class="fc-leaf fc-top fc-fold-top"><span class="fc-n">0</span><i class="fc-shade"></i></div>' +
      '<div class="fc-leaf fc-bottom fc-fold-bottom"><span class="fc-n">0</span><i class="fc-shade"></i></div>';
    return {
      el: d,
      cur: null,
      staticTop: d.querySelector('.fc-static-top .fc-n'),
      staticBottom: d.querySelector('.fc-static-bottom .fc-n'),
      foldTop: d.querySelector('.fc-fold-top'),
      foldTopN: d.querySelector('.fc-fold-top .fc-n'),
      foldTopShade: d.querySelector('.fc-fold-top .fc-shade'),
      foldBottom: d.querySelector('.fc-fold-bottom'),
      foldBottomN: d.querySelector('.fc-fold-bottom .fc-n'),
      foldBottomShade: d.querySelector('.fc-fold-bottom .fc-shade'),
      anims: [],
    };
  }

  function setImmediate(dg, val) {
    dg.cur = val;
    dg.staticTop.textContent = val;
    dg.staticBottom.textContent = val;
    dg.foldTop.style.transform = 'rotateX(0deg)';
    dg.foldBottom.style.transform = 'rotateX(90deg)';
    dg.foldTopN.textContent = val;
    dg.foldBottomN.textContent = val;
  }

  function flip(dg, val) {
    if (dg.cur === val) return;
    const old = dg.cur;
    dg.cur = val;

    if (reduced) { setImmediate(dg, val); return; }

    dg.anims.forEach((a) => a.cancel());
    dg.anims = [];

    // new value already visible on the top static face (revealed as the
    // old top flap falls away); bottom static stays old until the flip ends
    dg.staticTop.textContent = val;
    dg.staticBottom.textContent = old;
    dg.foldTopN.textContent = old;
    dg.foldBottomN.textContent = val;

    const DUR = 290;
    dg.foldTop.style.transform = 'rotateX(0deg)';
    dg.foldBottom.style.transform = 'rotateX(90deg)';

    const aTop = dg.foldTop.animate(
      [{ transform: 'rotateX(0deg)' }, { transform: 'rotateX(-90deg)' }],
      { duration: DUR, easing: 'cubic-bezier(.36,0,.66,-0.05)', fill: 'forwards' }
    );
    const aTopS = dg.foldTopShade.animate(
      [{ opacity: 0 }, { opacity: .45 }],
      { duration: DUR, easing: 'ease-in', fill: 'forwards' }
    );
    const aBot = dg.foldBottom.animate(
      [{ transform: 'rotateX(90deg)' }, { transform: 'rotateX(0deg)' }],
      { duration: DUR, delay: DUR, easing: 'cubic-bezier(.34,1.2,.64,1)', fill: 'both' }
    );
    const aBotS = dg.foldBottomShade.animate(
      [{ opacity: .5 }, { opacity: 0 }],
      { duration: DUR, delay: DUR, easing: 'ease-out', fill: 'both' }
    );
    dg.anims = [aTop, aTopS, aBot, aBotS];
    aBot.onfinish = () => { dg.staticBottom.textContent = val; };
  }

  function buildPair(host) {
    const pair = document.createElement('div');
    pair.className = 'fc-pair';
    const a = makeDigit(), b = makeDigit();
    pair.appendChild(a.el); pair.appendChild(b.el);
    return { el: pair, tens: a, ones: b };
  }

  class FlipClock extends HTMLElement {
    connectedCallback() {
      if (this._built) { this._start(); return; }
      this._built = true;

      const variant = this.getAttribute('variant') || 'classic';
      this.classList.add('flip-clock', 'fc-' + variant);

      this.fields = (this.getAttribute('fields') || 'hms').toLowerCase();
      this.hour12 = this.hasAttribute('hour12');
      this.showAmpm = this.hasAttribute('ampm');
      this.lang = this.getAttribute('lang') || 'zh';
      this.tz = this.getAttribute('tz') || '';
      this.metaTokens = (this.getAttribute('meta') || '')
        .split(',').map((s) => s.trim()).filter(Boolean);
      this.locationText = this.getAttribute('location') || '';

      // meta row
      if (this.metaTokens.length) {
        this.metaEl = document.createElement('div');
        this.metaEl.className = 'fc-meta';
        this.appendChild(this.metaEl);
      }

      // digit row
      const row = document.createElement('div');
      row.className = 'fc-row';
      this.hh = buildPair(this); row.appendChild(this.hh.el);
      this.mm = buildPair(this); row.appendChild(this.mm.el);
      if (this.fields === 'hms') { this.ss = buildPair(this); row.appendChild(this.ss.el); }

      if (this.showAmpm) {
        this.ampmEl = document.createElement('div');
        this.ampmEl.className = 'fc-ampm';
        this.ampmEl.innerHTML = '<b data-am>AM</b><b data-pm>PM</b>';
        row.appendChild(this.ampmEl);
      }
      this.appendChild(row);

      this._first = true;
      this._start();
    }

    disconnectedCallback() { this._stop(); }

    _start() {
      if (this._timer) return;
      const tick = () => {
        this._render(this._first);
        this._first = false;
        const now = Date.now();
        this._timer = setTimeout(tick, 1000 - (now % 1000));
      };
      tick();
    }
    _stop() { clearTimeout(this._timer); this._timer = null; }

    _render(immediate) {
      const z = (window.TZ ? window.TZ.parts(this.tz) : null) || (() => { const n = new Date(); return { h: n.getHours(), m: n.getMinutes(), s: n.getSeconds(), day: n.getDay(), date: n.getDate(), month: n.getMonth() + 1 }; })();
      let h = z.h;
      const isPm = h >= 12;
      if (this.hour12) { h = h % 12; if (h === 0) h = 12; }
      const m = z.m;
      const s = z.s;

      const set = (pair, value) => {
        const t = String(Math.floor(value / 10));
        const o = String(value % 10);
        if (immediate) { setImmediate(pair.tens, t); setImmediate(pair.ones, o); }
        else { flip(pair.tens, t); flip(pair.ones, o); }
      };
      set(this.hh, h);
      set(this.mm, m);
      if (this.ss) set(this.ss, s);

      if (this.ampmEl) {
        this.ampmEl.querySelector('[data-am]').classList.toggle('on', !isPm);
        this.ampmEl.querySelector('[data-pm]').classList.toggle('on', isPm);
      }

      if (this.metaEl) {
        const wd = (this.lang === 'en' ? WD_EN : WD_ZH)[z.day];
        const dateStr = this.lang === 'en'
          ? ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][z.month - 1] + ' ' + z.date
          : z.month + '月' + z.date + '日';
        const parts = this.metaTokens.map((tok) => {
          if (tok === 'weekday') return wd;
          if (tok === 'date') return dateStr;
          if (tok === 'location') return this.locationText;
          return '';
        }).filter(Boolean);
        // rebuild only when text changed (keeps DOM quiet)
        const joined = parts.join('\u0001');
        if (this._metaCache !== joined) {
          this._metaCache = joined;
          this.metaEl.innerHTML = parts
            .map((p) => '<span>' + p + '</span>')
            .join('<span class="fc-dot">·</span>');
        }
      }
    }
  }

  if (!customElements.get('flip-clock')) customElements.define('flip-clock', FlipClock);
})();
