/* ───────────────────────────────────────────────────────────
   <analog-clock> and <dual-clock>.
   <analog-clock variant="dark|light" seconds>
   <dual-clock   variant="dark|light" hour12 seconds
                 meta="weekday,date" location lang>

   Clocks with seconds tick on aligned whole seconds. Minute-only clocks
   tick on aligned whole minutes, and all timers pause while the page is
   hidden. This avoids a permanent animation frame loop in a desktop widget.
   ─────────────────────────────────────────────────────────── */
(function () {
  const WD_ZH = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const WD_EN = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  const MONTH_EN = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

  function stopAligned(host) {
    if (host._timer != null) clearTimeout(host._timer);
    host._timer = null;
    if (host._visibilityHandler) {
      document.removeEventListener('visibilitychange', host._visibilityHandler);
      host._visibilityHandler = null;
    }
  }

  function startAligned(host, cadence, render) {
    stopAligned(host);
    const schedule = () => {
      if (document.hidden) return;
      const remainder = Date.now() % cadence;
      const delay = (remainder === 0 ? cadence : cadence - remainder) + 8;
      host._timer = setTimeout(() => {
        host._timer = null;
        if (document.hidden) return;
        render();
        schedule();
      }, delay);
    };
    host._visibilityHandler = () => {
      if (host._timer != null) clearTimeout(host._timer);
      host._timer = null;
      if (!document.hidden) {
        render();
        schedule();
      }
    };
    document.addEventListener('visibilitychange', host._visibilityHandler);
    if (!document.hidden) {
      render();
      schedule();
    }
  }

  function currentParts(tz) {
    if (window.TZ) return window.TZ.parts(tz);
    const now = new Date();
    return {
      h: now.getHours(),
      m: now.getMinutes(),
      s: now.getSeconds(),
      day: now.getDay(),
      date: now.getDate(),
      month: now.getMonth() + 1,
    };
  }

  function buildFace(host, withSeconds) {
    host.classList.add('analog');
    for (let i = 0; i < 60; i++) {
      const tick = document.createElement('div');
      tick.className = 'ac-tick' + (i % 5 === 0 ? ' h' : '');
      tick.style.transform = 'rotate(' + (i * 6) + 'deg)';
      host.appendChild(tick);
    }
    const makeHand = (className) => {
      const hand = document.createElement('div');
      hand.className = 'ac-hand ' + className;
      host.appendChild(hand);
      return hand;
    };
    const hour = makeHand('ac-hour');
    const minute = makeHand('ac-minute');
    const second = withSeconds ? makeHand('ac-second') : null;
    const cap = document.createElement('div');
    cap.className = 'ac-cap';
    host.appendChild(cap);
    return { hour, minute, second };
  }

  function tickFace(hands, time, withSeconds) {
    const seconds = withSeconds ? time.s : 0;
    const minutes = time.m + seconds / 60;
    const hours = (time.h % 12) + minutes / 60;
    hands.hour.style.transform = 'rotate(' + (hours * 30) + 'deg)';
    hands.minute.style.transform = 'rotate(' + (minutes * 6) + 'deg)';
    if (hands.second) hands.second.style.transform = 'rotate(' + (seconds * 6) + 'deg)';
  }

  function numericTime(time, hour12, withSeconds) {
    let hour = time.h;
    if (hour12) hour = hour % 12 || 12;
    return String(hour).padStart(2, '0') + ':' + String(time.m).padStart(2, '0') +
      (withSeconds ? ':' + String(time.s).padStart(2, '0') : '');
  }

  function replaceSub(container, values) {
    const nodes = [];
    values.forEach((value, index) => {
      if (index) {
        const separator = document.createElement('span');
        separator.className = 'dl-accent';
        separator.textContent = '·';
        nodes.push(document.createTextNode(' '), separator, document.createTextNode(' '));
      }
      const item = document.createElement('span');
      item.textContent = value;
      nodes.push(item);
    });
    container.replaceChildren(...nodes);
  }

  class AnalogClock extends HTMLElement {
    connectedCallback() {
      if (!this._built) {
        this._built = true;
        this.classList.add('ac-' + (this.getAttribute('variant') || 'dark'));
        this.setAttribute('role', 'timer');
        this.setAttribute('aria-live', 'off');
        this.tz = this.getAttribute('tz') || '';
        this.withSeconds = this.hasAttribute('seconds');
        this._hands = buildFace(this, this.withSeconds);
      }
      this._run();
    }

    disconnectedCallback() { stopAligned(this); }

    _run() {
      startAligned(this, this.withSeconds ? 1000 : 60000, () => {
        const time = currentParts(this.tz);
        tickFace(this._hands, time, this.withSeconds);
        const zone = this.getAttribute('label') || this.tz || '本地时间';
        this.setAttribute('aria-label', zone + ' ' + numericTime(time, false, this.withSeconds));
      });
    }
  }

  class DualClock extends HTMLElement {
    connectedCallback() {
      if (!this._built) {
        this._built = true;
        this.classList.add('dual', 'dl-' + (this.getAttribute('variant') || 'dark'));
        this.setAttribute('role', 'timer');
        this.setAttribute('aria-live', 'off');
        this.hour12 = this.hasAttribute('hour12');
        this.withSeconds = this.hasAttribute('seconds');
        this.lang = this.getAttribute('lang') || 'zh';
        this.tz = this.getAttribute('tz') || '';
        this.metaTokens = (this.getAttribute('meta') || 'weekday,date')
          .split(',').map((value) => value.trim()).filter(Boolean);
        this.locationText = this.getAttribute('location') || '';

        this.face = document.createElement('div');
        this.face.className = 'analog ac-' + (this.getAttribute('variant') || 'dark');
        this.face.setAttribute('aria-hidden', 'true');
        this.appendChild(this.face);
        this._hands = buildFace(this.face, this.withSeconds);

        const read = document.createElement('div');
        read.className = 'dl-read';
        read.setAttribute('aria-hidden', 'true');
        this.timeEl = document.createElement('div');
        this.timeEl.className = 'dl-time';
        this.subEl = document.createElement('div');
        this.subEl.className = 'dl-sub';
        read.appendChild(this.timeEl);
        read.appendChild(this.subEl);
        this.appendChild(read);
      }
      this._run();
    }

    disconnectedCallback() { stopAligned(this); }

    _run() {
      startAligned(this, this.withSeconds ? 1000 : 60000, () => this._render());
    }

    _render() {
      const now = currentParts(this.tz);
      tickFace(this._hands, now, this.withSeconds);
      const time = numericTime(now, this.hour12, this.withSeconds);
      if (this._time !== time) {
        this._time = time;
        this.timeEl.textContent = time;
      }

      const weekday = (this.lang === 'en' ? WD_EN : WD_ZH)[now.day];
      const date = this.lang === 'en'
        ? MONTH_EN[now.month - 1] + ' ' + now.date
        : now.month + '月' + now.date + '日';
      const values = this.metaTokens.map((token) => {
        if (token === 'weekday') return weekday;
        if (token === 'date') return date;
        if (token === 'location') return this.locationText;
        return '';
      }).filter(Boolean);
      const sub = values.join('\u0001');
      if (this._sub !== sub) {
        this._sub = sub;
        replaceSub(this.subEl, values);
      }

      const zone = this.locationText || this.tz || (this.lang === 'en' ? 'Local time' : '本地时间');
      const period = this.hour12
        ? ' ' + (this.lang === 'en' ? (now.h >= 12 ? 'PM' : 'AM') : (now.h >= 12 ? '下午' : '上午'))
        : '';
      this.setAttribute('aria-label', zone + ' ' + time + period + ', ' + weekday + ' ' + date);
    }
  }

  if (!customElements.get('analog-clock')) customElements.define('analog-clock', AnalogClock);
  if (!customElements.get('dual-clock')) customElements.define('dual-clock', DualClock);
})();
