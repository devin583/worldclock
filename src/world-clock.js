/* ───────────────────────────────────────────────────────────
   <zone-meta>  — city + UTC offset + day/night + diff-vs-home
   <world-pair> — two zones with a time-difference marker

   Both rely on window.TZ and reuse <flip-clock> / <analog-clock>.
   Metadata is minute-aligned and stops updating while the page is hidden.
   ─────────────────────────────────────────────────────────── */
(function () {
  const FLIP_VARIANTS = new Set(['classic', 'minimal', 'cute', 'glass']);

  function pairAppearance(host) {
    const rawVariant = host.getAttribute('variant') || 'classic';
    const legacyScheme = rawVariant === 'light' || rawVariant === 'dark'
      ? rawVariant
      : null;
    const variant = legacyScheme
      ? (legacyScheme === 'light' ? 'minimal' : 'classic')
      : (FLIP_VARIANTS.has(rawVariant) ? rawVariant : 'classic');
    const requestedScheme = host.getAttribute('color-scheme');
    const inferredScheme = variant === 'minimal' || variant === 'cute' ? 'light' : 'dark';
    const scheme = requestedScheme === 'light' || requestedScheme === 'dark'
      ? requestedScheme
      : (legacyScheme || inferredScheme);
    return { variant, scheme };
  }

  function configureWorldPair(element, options) {
    const attributes = {
      type: options.type,
      layout: options.layout,
      variant: options.variant,
      'color-scheme': options.colorScheme,
      lang: options.lang,
      'a-tz': options.clockA?.tz,
      'a-label': options.clockA?.label,
      'b-tz': options.clockB?.tz,
      'b-label': options.clockB?.label,
    };
    for (const [name, value] of Object.entries(attributes)) {
      if (value != null && value !== '') element.setAttribute(name, String(value));
    }
    for (const [name, enabled] of [['seconds', options.showSeconds], ['hour12', options.hour12]]) {
      if (enabled) element.setAttribute(name, '');
      else element.removeAttribute(name);
    }
    return element;
  }

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

  // ── zone-meta ──────────────────────────────────────────────
  class ZoneMeta extends HTMLElement {
    connectedCallback() {
      if (!this._built) {
        this._built = true;
        const scheme = this.getAttribute('variant') || 'dark';
        this.classList.add('zone-meta', 'zm-' + scheme);
        this.setAttribute('role', 'group');
        if (this.hasAttribute('center')) this.classList.add('zm-center');
        this.tz = this.getAttribute('tz') || '';
        this.home = this.getAttribute('home') || '';
        this.homeLabel = this.getAttribute('home-label') || '';
        this.label = this.getAttribute('label') || '';
        this.lang = this.getAttribute('lang') || 'zh';
        this.showDiff = this.hasAttribute('diff');
        this.short = this.hasAttribute('short');

        this.head = document.createElement('div');
        this.head.className = 'zm-head';
        this.head.setAttribute('aria-hidden', 'true');
        this.cityEl = document.createElement('span');
        this.cityEl.className = 'zm-city';
        this.cityEl.textContent = this.label;
        this.offEl = document.createElement('span');
        this.offEl.className = 'zm-off';
        this.dnEl = document.createElement('span');
        this.dnEl.className = 'zm-dn';
        const dot = document.createElement('i');
        dot.className = 'zm-dot';
        this.dayNightText = document.createElement('span');
        this.dayNightText.className = 'zm-dnt';
        this.dnEl.appendChild(dot);
        this.dnEl.appendChild(this.dayNightText);
        this.head.appendChild(this.cityEl);
        this.head.appendChild(this.offEl);
        this.head.appendChild(this.dnEl);
        this.appendChild(this.head);
        if (this.showDiff) {
          this.diffEl = document.createElement('div');
          this.diffEl.className = 'zm-diff';
          this.diffEl.setAttribute('aria-hidden', 'true');
          this.appendChild(this.diffEl);
        }
      }
      this._run();
    }

    disconnectedCallback() { stopAligned(this); }

    _run() {
      startAligned(this, 60000, () => this._render());
    }

    _render() {
      const timezone = window.TZ;
      if (!timezone) return;
      const instant = new Date();
      const offset = timezone.offsetLabel(this.tz, instant);
      this.offEl.textContent = offset;
      const isDaytime = timezone.isDay(this.tz, instant);
      const dayNight = this.lang === 'en'
        ? (isDaytime ? 'Day' : 'Night')
        : (isDaytime ? '白天' : '夜晚');
      this.dnEl.className = 'zm-dn ' + (isDaytime ? 'day' : 'night');
      this.dayNightText.textContent = dayNight;
      let difference = '';
      if (this.diffEl) {
        difference = timezone.diffText(
          this.tz,
          this.home,
          this.lang,
          this.homeLabel,
          this.short,
          instant
        );
        this.diffEl.textContent = difference;
      }
      this.setAttribute(
        'aria-label',
        [this.label || this.tz, offset, dayNight, difference].filter(Boolean).join(', ')
      );
    }
  }

  // ── helpers to spawn a dial ────────────────────────────────────
  function makeDial(type, variant, scheme, tz, size, withSeconds, hour12) {
    if (type === 'analog') {
      const analog = document.createElement('analog-clock');
      analog.setAttribute('variant', scheme);
      if (withSeconds) analog.setAttribute('seconds', '');
      if (tz) analog.setAttribute('tz', tz);
      analog.style.cssText = '--size:' + (size || 150) + 'px';
      return analog;
    }
    const flip = document.createElement('flip-clock');
    flip.setAttribute('variant', variant);
    flip.setAttribute('fields', withSeconds ? 'hms' : 'hm');
    if (tz) flip.setAttribute('tz', tz);
    if (hour12) {
      flip.setAttribute('hour12', '');
      flip.setAttribute('ampm', '');
    }
    return flip;
  }

  // ── world-pair ───────────────────────────────────────────────
  class WorldPair extends HTMLElement {
    connectedCallback() {
      if (this._built) {
        this._start();
        return;
      }
      this._built = true;
      const { variant, scheme } = pairAppearance(this);
      const layout = this.getAttribute('layout') || 'stack';
      const type = this.getAttribute('type') || 'digital';
      this.lang = this.getAttribute('lang') || 'zh';
      this.withSeconds = this.hasAttribute('seconds');
      this.hour12 = this.hasAttribute('hour12');
      this.classList.add('world-pair', layout === 'row' ? 'wp-row' : 'wp-stack');
      this.setAttribute('role', 'group');
      if (scheme === 'light') this.classList.add('wp-light');

      this.aTz = this.getAttribute('a-tz') || '';
      this.aLabel = this.getAttribute('a-label') || '';
      this.bTz = this.getAttribute('b-tz') || '';
      this.bLabel = this.getAttribute('b-label') || '';
      this._pills = [];

      const meta = (tz, label, withDiff, center) => {
        const zone = document.createElement('zone-meta');
        zone.setAttribute('variant', scheme);
        zone.setAttribute('tz', tz);
        zone.setAttribute('label', label);
        zone.setAttribute('lang', this.lang);
        if (center) zone.setAttribute('center', '');
        if (withDiff) {
          zone.setAttribute('diff', '');
          zone.setAttribute('home', this.aTz);
          zone.setAttribute('home-label', this.aLabel);
        }
        return zone;
      };

      const diffPill = () => {
        const pill = document.createElement('div');
        pill.className = 'wp-pill';
        pill.setAttribute('aria-hidden', 'true');
        this._pills.push(pill);
        return pill;
      };

      if (layout === 'row') {
        const columnA = document.createElement('div');
        columnA.className = 'wp-zone';
        columnA.appendChild(makeDial(type, variant, scheme, this.aTz, 150, this.withSeconds, this.hour12));
        columnA.appendChild(meta(this.aTz, this.aLabel, false, true));
        const middle = document.createElement('div');
        middle.className = 'wp-mid';
        const lineA = document.createElement('div');
        lineA.className = 'wp-line-v';
        const lineB = document.createElement('div');
        lineB.className = 'wp-line-v';
        middle.appendChild(lineA);
        middle.appendChild(diffPill());
        middle.appendChild(lineB);
        const columnB = document.createElement('div');
        columnB.className = 'wp-zone';
        columnB.appendChild(makeDial(type, variant, scheme, this.bTz, 150, this.withSeconds, this.hour12));
        columnB.appendChild(meta(this.bTz, this.bLabel, false, true));
        this.appendChild(columnA);
        this.appendChild(middle);
        this.appendChild(columnB);
      } else {
        const rowA = document.createElement('div');
        rowA.className = 'wp-zone';
        rowA.appendChild(meta(this.aTz, this.aLabel, false, false));
        rowA.appendChild(makeDial(type, variant, scheme, this.aTz, 132, this.withSeconds, this.hour12));
        const divider = document.createElement('div');
        divider.className = 'wp-divider';
        divider.appendChild(diffPill());
        const rowB = document.createElement('div');
        rowB.className = 'wp-zone';
        rowB.appendChild(meta(this.bTz, this.bLabel, false, false));
        rowB.appendChild(makeDial(type, variant, scheme, this.bTz, 132, this.withSeconds, this.hour12));
        this.appendChild(rowA);
        this.appendChild(divider);
        this.appendChild(rowB);
      }
      this._start();
    }

    disconnectedCallback() { stopAligned(this); }

    _start() {
      startAligned(this, 60000, () => this._renderDifference());
    }

    _renderDifference() {
      const timezone = window.TZ;
      if (!timezone) return;
      const instant = new Date();
      const difference = timezone.offsetMin(this.bTz, instant) -
        timezone.offsetMin(this.aTz, instant);
      const amount = Math.abs(difference) / 60;
      const formatted = Number.isInteger(amount)
        ? String(amount)
        : amount.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
      const text = difference === 0
        ? (this.lang === 'en' ? 'Same time' : '同步')
        : (difference > 0 ? '+' : '\u2212') + formatted + 'h';
      for (const pill of this._pills) pill.textContent = text;
      const relation = difference === 0
        ? (this.lang === 'en' ? 'same time' : '时间同步')
        : text;
      this.setAttribute(
        'aria-label',
        [this.aLabel || this.aTz, this.bLabel || this.bTz, relation].filter(Boolean).join(', ')
      );
    }
  }

  if (!customElements.get('zone-meta')) customElements.define('zone-meta', ZoneMeta);
  if (!customElements.get('world-pair')) customElements.define('world-pair', WorldPair);
  window.WCWorldClock = Object.freeze({ configureWorldPair });
})();
