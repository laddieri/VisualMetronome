/* Visual Metronome — Layout v2
 *
 * Responsibilities (all isolated from script.js):
 *   1. Theme: read user preference, persist, toggle.
 *   2. DOM reorg: at startup, move the existing control-groups out of
 *      the legacy .controls container and into the new transport bar +
 *      Display / Sound / Rhythm panels. All element IDs are preserved
 *      so script.js handlers continue to work without modification.
 *   3. Icon-rail flyout panel: open/close on desktop.
 *   4. Bottom sheet: drag-to-expand on mobile.
 *   5. More menu: open/close, click-outside dismiss.
 */
(function () {
  'use strict';

  // ───── Theme ───────────────────────────────────────────────────────────
  var THEME_KEY = 'vm.theme';

  // Read the current --vm-canvas-bg from CSS and publish it for script.js to
  // pick up. script.js's draw() and notation SVG builder consult
  // window.vmCanvasBg so the p5 stage and SVG match the active theme.
  function syncCanvasBg() {
    var c = getComputedStyle(document.documentElement)
              .getPropertyValue('--vm-canvas-bg').trim();
    if (c) window.vmCanvasBg = c;

    // Re-paint existing notation SVG rects so the new color shows
    // immediately without waiting for the next render trigger.
    document.querySelectorAll('.nd-bg-rect').forEach(function (r) {
      // Preserve practice-rhythm "your turn" green; only swap the base.
      var current = r.getAttribute('fill');
      if (current !== '#3a5c2a') r.setAttribute('fill', window.vmCanvasBg);
    });
  }

  function applyTheme(theme) {
    if (theme === 'dark' || theme === 'light') {
      document.documentElement.setAttribute('data-theme', theme);
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
    syncCanvasBg();
  }

  function initTheme() {
    var stored = null;
    try { stored = localStorage.getItem(THEME_KEY); } catch (e) { stored = null; }
    applyTheme(stored);

    var btn = document.getElementById('theme-toggle');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var current = document.documentElement.getAttribute('data-theme');
      var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      var nextTheme;
      if (current === 'dark') {
        nextTheme = 'light';
      } else if (current === 'light') {
        nextTheme = 'dark';
      } else {
        nextTheme = prefersDark ? 'light' : 'dark';
      }
      applyTheme(nextTheme);
      try { localStorage.setItem(THEME_KEY, nextTheme); } catch (e) { /* ignore */ }
    });

    // If the user changes their OS preference while the app is open AND they
    // haven't picked an explicit theme, keep the canvas color in sync.
    if (window.matchMedia) {
      var mq = window.matchMedia('(prefers-color-scheme: dark)');
      var listener = function () {
        if (!document.documentElement.getAttribute('data-theme')) syncCanvasBg();
      };
      if (mq.addEventListener) mq.addEventListener('change', listener);
      else mq.addListener(listener);
    }
  }

  // ───── DOM reorganization ─────────────────────────────────────────────
  function $(id) { return document.getElementById(id); }

  function moveControlsIntoLayout() {
    // The legacy .controls subtree currently contains:
    //   .controls-primary  ─ play buttons, tempo controls
    //   .controls-secondary ─ all secondary controls + utility buttons
    //
    // We pull specific children OUT of it and place them into the new
    // shell. The legacy wrappers stay in place (display: contents) so
    // script.js's `.controls` query for zoom still finds something.

    // ── Transport ──
    var transportPlay = $('transport-play-slot');
    var transportTempoSlot = $('transport-tempo-slot');
    var transportMetaSlot  = $('transport-meta-slot');

    var playBtnGroup = document.querySelector('.controls .play-button-group');
    if (playBtnGroup && transportPlay) {
      transportPlay.appendChild(playBtnGroup);
    }

    var tempoControls = document.querySelector('.controls .tempo-controls');
    if (tempoControls && transportTempoSlot) {
      transportTempoSlot.appendChild(tempoControls);
    }

    // Wrap the beats/measure and beat-note selects in compact meta blocks
    var beatsSelect = $('time-signature');
    var beatsGroup  = beatsSelect && beatsSelect.closest('.control-group');
    if (beatsGroup && transportMetaSlot) {
      var beatsMeta = document.createElement('div');
      beatsMeta.className = 'meta-group';
      beatsMeta.id = 'tr-beats-group';
      var beatsLabel = document.createElement('span');
      beatsLabel.className = 'meta-label';
      beatsLabel.textContent = 'Beats';
      beatsMeta.appendChild(beatsLabel);
      beatsMeta.appendChild(beatsSelect);
      transportMetaSlot.appendChild(beatsMeta);
      // The original control-group wrapper is now empty; we can leave it.
      if (beatsGroup.parentNode) beatsGroup.parentNode.removeChild(beatsGroup);
    }

    var beatNoteRow = $('beat-note-row');
    if (beatNoteRow && transportMetaSlot) {
      // Repackage with the unified meta style
      var noteSelect = $('beat-note-select');
      var beatNoteMeta = document.createElement('div');
      beatNoteMeta.className = 'meta-group';
      beatNoteMeta.id = 'tr-beat-note-group';
      // Mirror display:none/show behavior of the original wrapper:
      beatNoteMeta.style.display = beatNoteRow.style.display || 'none';
      var noteLabel = document.createElement('span');
      noteLabel.className = 'meta-label';
      noteLabel.textContent = 'Beat';
      beatNoteMeta.appendChild(noteLabel);
      if (noteSelect) beatNoteMeta.appendChild(noteSelect);
      transportMetaSlot.appendChild(beatNoteMeta);
      // Mirror visibility changes back onto the wrapper so script.js's
      // existing `beat-note-row.style.display = ...` calls continue to
      // hide/show this UI even though the markup has moved.
      var origStyle = beatNoteRow.style;
      var setter = Object.getOwnPropertyDescriptor(CSSStyleDeclaration.prototype, 'display');
      try {
        Object.defineProperty(beatNoteRow.style, 'display', {
          configurable: true,
          get: function () { return beatNoteMeta.style.display; },
          set: function (val) { beatNoteMeta.style.display = val; }
        });
      } catch (e) {
        // Fallback: poll via MutationObserver on the original wrapper
        new MutationObserver(function () {
          beatNoteMeta.style.display = beatNoteRow.style.display || 'none';
        }).observe(beatNoteRow, { attributes: true, attributeFilter: ['style'] });
      }
      // Hide the original empty wrapper either way
      beatNoteRow.style.visibility = 'hidden';
      beatNoteRow.style.position = 'absolute';
      beatNoteRow.style.pointerEvents = 'none';
      beatNoteRow.style.width = '0';
      beatNoteRow.style.height = '0';
      beatNoteRow.style.overflow = 'hidden';
    }

    // ── Display panel ──
    var displayBody = $('panel-display-body');
    if (displayBody) {
      // Animation selector (lives inside its own .control-group)
      var animSelect = $('animal-selector');
      var animGroup  = animSelect && animSelect.closest('.control-group');
      if (animGroup) displayBody.appendChild(animGroup);

      // Direction
      var dirGroup = $('direction-group');
      if (dirGroup) displayBody.appendChild(dirGroup);

      // Color (circle/animation)
      var colorGroup = $('color-picker-group');
      if (colorGroup) displayBody.appendChild(colorGroup);

      // Notation ball shape + color (score mode only — wrappers carry display:none)
      var ballGroup = $('notation-ball-group');
      if (ballGroup) displayBody.appendChild(ballGroup);
      var ballColorGroup = $('notation-ball-color-group');
      if (ballColorGroup) displayBody.appendChild(ballColorGroup);

      // Animation size — pull the floating right-rail slider into the panel
      var sizeRail = $('anim-size-rail');
      if (sizeRail) {
        var wrap = document.createElement('div');
        wrap.className = 'anim-size-rail-inline';
        var lbl = document.createElement('label');
        lbl.setAttribute('for', 'anim-size-slider');
        lbl.textContent = 'Animation size';
        wrap.appendChild(lbl);
        // Move just the slider, drop the +/- labels (the slider is self-explanatory in horizontal)
        var slider = $('anim-size-slider');
        if (slider) {
          // Reset writing-mode/dir that were set in the legacy CSS
          slider.style.writingMode = 'horizontal-tb';
          slider.style.direction = 'ltr';
          wrap.appendChild(slider);
        }
        displayBody.appendChild(wrap);
        // Remove the now-empty rail wrapper
        if (sizeRail.parentNode) sizeRail.parentNode.removeChild(sizeRail);
      }
    }

    // ── Sound panel ──
    var soundBody = $('panel-sound-body');
    if (soundBody) {
      var subdivGroup = $('subdivision-group');
      if (subdivGroup) soundBody.appendChild(subdivGroup);

      // Pull a subset of advanced settings out of the settings modal into Sound
      var metronomeSoundGroup = $('metronome-sound-group');
      if (metronomeSoundGroup) soundBody.appendChild(metronomeSoundGroup);

      var rockGroup  = $('rock-beat-setting-group');
      if (rockGroup) soundBody.appendChild(rockGroup);
      var waltzGroup = $('waltz-beat-setting-group');
      if (waltzGroup) soundBody.appendChild(waltzGroup);

      // Move some checkbox toggles too (accent, voice count, flash) — we
      // identify them by their checkbox ID and lift the parent .setting-group.
      ['accent-enabled', 'voice-count-enabled', 'flash-enabled', 'animal-sound-enabled'].forEach(function (id) {
        var cb = document.getElementById(id);
        if (!cb) return;
        var group = cb.closest('.setting-group');
        if (group) soundBody.appendChild(group);
      });
    }

    // ── Rhythm panel ──
    var rhythmBody = $('panel-rhythm-body');
    if (rhythmBody) {
      // Build pattern buttons. We *reuse* the existing util-button IDs by
      // moving them into the panel and wrapping with rich content.
      var defs = [
        { id: 'two-measure-btn',     emoji: '⚡', title: 'Two-Measure Pattern',
          sub: 'Define two alternating measures' },
        { id: 'custom-rhythm-btn',   emoji: '🥁', title: 'Custom Rhythm',
          sub: 'Build a one-measure rhythm' },
        { id: 'song-sections-btn',   emoji: '🎶', title: 'Song Sections',
          sub: 'Tempo + meter changes through a song' },
        { id: 'counting-trainer-btn', emoji: '🎯', title: 'Counting Trainer',
          sub: 'Count silent measures aloud' }
      ];
      defs.forEach(function (def) {
        var btn = $(def.id);
        if (!btn) return;
        // Strip legacy classes that styled the button as a small icon-only
        btn.classList.remove('utility-btn');
        btn.classList.add('pattern-btn');
        // Wipe any title-only short text and rebuild the inner markup
        btn.removeAttribute('title');
        btn.innerHTML =
          '<span class="pattern-emoji" aria-hidden="true">' + def.emoji + '</span>' +
          '<span class="pattern-text">' + def.title +
            '<span class="pattern-sub">' + def.sub + '</span>' +
          '</span>' +
          '<span class="pattern-dot" aria-hidden="true"></span>' +
          '<span class="pattern-chev" aria-hidden="true">▸</span>';
        rhythmBody.appendChild(btn);
      });
    }

    // ── Notation display + practice rhythm row → stage (below canvas) ──
    var stage = document.querySelector('.app-shell .stage');
    var notation = $('notation-display-wrapper');
    var practice = $('practice-rhythm-row');
    if (stage) {
      if (notation) stage.appendChild(notation);
      if (practice) stage.appendChild(practice);
    }

    // ── Hide the legacy container completely ──
    var legacy = document.querySelector('body > .container');
    if (legacy) {
      legacy.style.display = 'none';
    }

    // ── Reset button → header more menu ──
    var resetBtn = $('reset-settings-btn');
    var resetSlot = $('more-reset-slot');
    if (resetBtn && resetSlot) {
      resetBtn.classList.remove('toggle', 'reset-settings-btn');
      resetBtn.classList.add('danger');
      resetBtn.removeAttribute('title');
      resetBtn.textContent = '↺  Reset all settings';
      resetSlot.appendChild(resetBtn);
    }

    // ── Remote button → header more menu ──
    var remoteBtn = $('remote-btn');
    var remoteSlot = $('more-remote-slot');
    if (remoteBtn && remoteSlot) {
      remoteBtn.classList.remove('utility-btn');
      remoteBtn.textContent = '📱  Phone Remote';
      remoteSlot.appendChild(remoteBtn);
      // The script.js logic toggles `remote-btn.classList.remove('hidden')`
      // when a remote is available — keep that working.
    }
  }

  // ───── Icon rail / panel ───────────────────────────────────────────────
  function initRailPanels() {
    var rail = document.getElementById('icon-rail');
    var host = document.getElementById('panel-host');
    var scrim = document.getElementById('panel-scrim');
    if (!rail || !host) return;

    function closePanel() {
      host.classList.remove('open');
      if (scrim) scrim.classList.remove('open');
      var pressed = rail.querySelector('[aria-pressed="true"]');
      if (pressed) pressed.setAttribute('aria-pressed', 'false');
    }

    function openPanel(name) {
      var panels = host.querySelectorAll('.panel');
      var match = host.querySelector('.panel[data-panel="' + name + '"]');
      if (!match) return;
      panels.forEach(function (p) { p.classList.toggle('is-open', p === match); });
      host.classList.add('open');
      if (scrim) scrim.classList.add('open');
      rail.querySelectorAll('.rail-btn').forEach(function (b) {
        b.setAttribute('aria-pressed', String(b.dataset.panel === name));
      });
      // Sync panel header label
      var meta = {
        display: { emoji: '🎨', label: 'Display' },
        sound:   { emoji: '🔊', label: 'Sound' },
        rhythm:  { emoji: '🎵', label: 'Rhythm' }
      }[name] || { emoji: '', label: '' };
      var emEl = document.getElementById('panel-host-emoji');
      var nmEl = document.getElementById('panel-host-name');
      if (emEl) emEl.textContent = meta.emoji;
      if (nmEl) nmEl.textContent = meta.label;
    }

    rail.querySelectorAll('.rail-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var name = btn.dataset.panel;
        if (btn.getAttribute('aria-pressed') === 'true') {
          closePanel();
        } else {
          openPanel(name);
        }
      });
    });

    var closeBtn = host.querySelector('.panel-close');
    if (closeBtn) closeBtn.addEventListener('click', closePanel);

    if (scrim) scrim.addEventListener('click', closePanel);

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && host.classList.contains('open')) {
        closePanel();
      }
    });
  }

  // ───── Bottom sheet ────────────────────────────────────────────────────
  function initSheet() {
    var sheet = document.getElementById('mobile-sheet');
    if (!sheet) return;

    function expand() { sheet.classList.remove('collapsed'); }
    function collapse() { sheet.classList.add('collapsed'); }

    var grip = sheet.querySelector('.sheet-grip');
    if (grip) {
      grip.addEventListener('click', function () {
        if (sheet.classList.contains('collapsed')) expand(); else collapse();
      });

      // Drag-to-dismiss: if the user is expanded and drags the grip down by
      // 24px or more, collapse the sheet. We don't drive the expand direction
      // here — the click handler covers tap-to-expand and feels more reliable.
      var startY = null;
      grip.addEventListener('touchstart', function (e) {
        if (sheet.classList.contains('collapsed')) return;
        startY = e.touches[0].clientY;
      }, { passive: true });
      grip.addEventListener('touchmove', function (e) {
        if (startY == null) return;
        var dy = e.touches[0].clientY - startY;
        if (dy > 24) { collapse(); startY = null; }
      }, { passive: true });
      grip.addEventListener('touchend', function () { startY = null; });
      grip.addEventListener('touchcancel', function () { startY = null; });
    }

    // Tabs
    var tabs = sheet.querySelectorAll('.sheet-tab');
    function showTab(name) {
      tabs.forEach(function (t) { t.setAttribute('aria-pressed', String(t.dataset.panel === name)); });
      var mobileHost = document.getElementById('panel-host-mobile');
      var panels = mobileHost ? mobileHost.querySelectorAll('.panel') : [];
      panels.forEach(function (p) { p.classList.toggle('is-open', p.dataset.panel === name); });
    }
    tabs.forEach(function (t) {
      t.addEventListener('click', function () {
        if (sheet.classList.contains('collapsed')) expand();
        showTab(t.dataset.panel);
      });
    });
    if (tabs.length) showTab(tabs[0].dataset.panel);

    // Sync DOM: on small screens, move the panel content into the
    // mobile host; on larger screens, into the desktop host. We do this
    // once on init based on the viewport and again on breakpoint change.
    var mq = window.matchMedia('(max-width: 900px)');
    function syncHosts(matches) {
      var desktopHost = document.getElementById('panel-host');
      var mobileHost  = document.getElementById('panel-host-mobile');
      var transportDesktop = document.getElementById('transport-bar');
      var transportMobile  = document.getElementById('sheet-transport');
      if (!desktopHost || !mobileHost) return;

      ['display', 'sound', 'rhythm'].forEach(function (name) {
        var current = document.querySelector('.panel[data-panel="' + name + '"]');
        if (!current) return;
        var target = matches ? mobileHost : desktopHost;
        if (current.parentElement !== target) target.appendChild(current);
      });

      // Move transport contents
      if (transportDesktop && transportMobile) {
        var playSlot   = document.getElementById('transport-play-slot');
        var tempoSlot  = document.getElementById('transport-tempo-slot');
        var metaSlot   = document.getElementById('transport-meta-slot');
        var mPlaySlot  = document.getElementById('sheet-play-slot');
        var mTempoSlot = document.getElementById('sheet-tempo-slot');
        var mMetaSlot  = document.getElementById('sheet-meta-slot');

        if (matches) {
          if (mPlaySlot && playSlot && playSlot.firstChild)   mPlaySlot.appendChild(playSlot.firstChild);
          if (mTempoSlot && tempoSlot && tempoSlot.firstChild) mTempoSlot.appendChild(tempoSlot.firstChild);
          if (mMetaSlot && metaSlot) {
            while (metaSlot.firstChild) mMetaSlot.appendChild(metaSlot.firstChild);
          }
        } else {
          if (playSlot && mPlaySlot && mPlaySlot.firstChild)  playSlot.appendChild(mPlaySlot.firstChild);
          if (tempoSlot && mTempoSlot && mTempoSlot.firstChild) tempoSlot.appendChild(mTempoSlot.firstChild);
          if (metaSlot && mMetaSlot) {
            while (mMetaSlot.firstChild) metaSlot.appendChild(mMetaSlot.firstChild);
          }
        }
      }
    }
    syncHosts(mq.matches);
    var listener = function (e) { syncHosts(e.matches); };
    if (mq.addEventListener) mq.addEventListener('change', listener);
    else mq.addListener(listener);
  }

  // ───── More menu ───────────────────────────────────────────────────────
  function initMoreMenu() {
    var wrap = document.getElementById('more-menu');
    var btn  = document.getElementById('more-btn');
    if (!wrap || !btn) return;

    function open() {
      wrap.classList.add('open');
      btn.setAttribute('aria-expanded', 'true');
    }
    function close() {
      wrap.classList.remove('open');
      btn.setAttribute('aria-expanded', 'false');
    }

    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (wrap.classList.contains('open')) close(); else open();
    });

    document.addEventListener('click', function (e) {
      if (!wrap.contains(e.target)) close();
    });

    // Close menu when a menu item is clicked
    wrap.addEventListener('click', function (e) {
      var item = e.target.closest('button');
      if (item && item !== btn) {
        // Defer close so the item's own click handler still runs
        setTimeout(close, 0);
      }
    });
  }

  // ───── Init ────────────────────────────────────────────────────────────
  function init() {
    initTheme();
    moveControlsIntoLayout();
    initRailPanels();
    initSheet();
    initMoreMenu();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
