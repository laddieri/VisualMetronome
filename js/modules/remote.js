import { state } from './state.js';
import { createAnimals } from './animations.js';
import { crRenderNotation, crRenderNotationDisplay } from './custom-rhythm.js';
import { enterFullscreen, exitFullscreen } from './stage.js';
import { applyBPM } from './tempo.js';
import { _ensureAudioContext, _syncAnimSize, toggleTransport } from './transport.js';
import {
  _sync3DConductor, _syncBeatNoteRow, _syncNotationDisplay, _syncPracticeRow, _syncWebGPUCanvas, updateColorPickerVisibility,
} from './view-sync.js';


// ═══════════════════════════════════════════════════════════════════════════
// REMOTE CONTROL
//
// Auto-selects a transport on startup:
//
//   WebSocket relay  (node server.js, local network)
//     – tries ws:// on the same host; if it connects within 1.5 s, use it
//     – QR code encodes http://<local-IP>/remote.html  (phone on same Wi-Fi)
//
//   PeerJS / WebRTC  (GitHub Pages or any static host)
//     – fallback when WebSocket fails to connect
//     – desktop gets a PeerJS peer ID; QR code encodes
//       <origin>/remote.html?p=<peerID>
//     – phone opens that URL, connects directly P2P via WebRTC data channel
//
// The 📱 button is hidden until one transport is confirmed ready.
// ═══════════════════════════════════════════════════════════════════════════

var _remoteMode = null;   // 'ws' | 'peer'
var _remoteWS   = null;
var _peer       = null;
var _peerId     = null;
var _peerConns  = new Set();

export function initRemoteControl() {
  var remoteBtn        = document.getElementById('remote-btn');
  var remoteModal      = document.getElementById('remote-modal');
  var remoteModalClose = document.getElementById('remote-modal-close-btn');

  // ── Transport detection ──────────────────────────────────────────────────
  // Try WebSocket to the local server first.  If it connects quickly we stay
  // in WS mode; otherwise we initialise PeerJS for the GitHub Pages case.
  var modeDecided = false;

  function decidePeer() {
    if (modeDecided) return;
    modeDecided = true;
    _remoteMode = 'peer';
    initPeerMode(remoteBtn);
  }

  function decideWS(ws) {
    if (modeDecided) return;
    modeDecided = true;
    _remoteMode = 'ws';
    _attachWSHandlers(ws, remoteBtn);
    // Also start PeerJS as a backup transport for restricted networks (e.g. school
    // WiFi that blocks port 9090 or uses AP isolation). The peer QR code will be
    // shown alongside the local-network QR code in the remote modal.
    initPeerMode(null);
  }

  // Opened in an IIFE so the inner tryWS can tail-call itself for reconnects
  (function tryWS() {
    var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    var ws    = new WebSocket(proto + '//' + location.host);

    ws.onopen  = function () { decideWS(ws); };
    ws.onerror = function () {};  // onclose follows; handled below

    ws.onclose = function () {
      if (_remoteMode === 'ws') {
        // Mid-session drop after mode was confirmed: reconnect
        _remoteWS = null;
        setTimeout(tryWS, 3000);
      }
      // If still in detection phase, the timeout below fires decidePeer
    };

    // If WS hasn't connected within 1.5 s, assume no local server → PeerJS
    setTimeout(function () {
      if (!modeDecided) { try { ws.close(); } catch (e) {} decidePeer(); }
    }, 1500);
  })();

  // ── Modal wiring ─────────────────────────────────────────────────────────
  if (remoteBtn) {
    remoteBtn.addEventListener('click', showQRModal);
  }
  if (remoteModalClose) {
    remoteModalClose.addEventListener('click', function () {
      if (remoteModal) remoteModal.classList.add('hidden');
    });
  }
  if (remoteModal) {
    remoteModal.addEventListener('click', function (e) {
      if (e.target === remoteModal) remoteModal.classList.add('hidden');
    });
  }
}

function _attachWSHandlers(ws, remoteBtn) {
  _remoteWS = ws;
  if (remoteBtn) remoteBtn.classList.remove('hidden');
  sendStateUpdate();
  ws.onmessage = function (evt) {
    try { applyRemoteCommand(JSON.parse(evt.data)); } catch (e) {}
  };
  // ws.onclose reconnect is already wired in the tryWS IIFE above
}

// ── QR rendering helper ──────────────────────────────────────────────────────
function _renderQR(container, url) {
  container.innerHTML = '';
  if (typeof QRCode !== 'undefined') {
    new QRCode(container, {
      text: url, width: 200, height: 200,
      colorDark: '#000000', colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.M,
    });
  }
}

// ── PeerJS (desktop side) ────────────────────────────────────────────────────
function initPeerMode(remoteBtn) {
  if (typeof Peer === 'undefined') return; // CDN not loaded

  _peer = new Peer();

  _peer.on('open', function (id) {
    _peerId = id;
    if (remoteBtn) remoteBtn.classList.remove('hidden');
    // If the QR modal is already open in dual-QR (WS) mode, fill in the peer
    // QR code now — it couldn't be rendered earlier because we didn't have an
    // ID yet.
    var dualSection = document.getElementById('remote-dual-section');
    if (dualSection && !dualSection.classList.contains('hidden')) {
      var peerQrEl  = document.getElementById('qr-code-peer');
      var peerUrlEl = document.getElementById('remote-url-peer');
      var pUrl = location.origin + '/remote.html?p=' + id;
      if (peerQrEl)  _renderQR(peerQrEl, pUrl);
      if (peerUrlEl) peerUrlEl.textContent = pUrl;
    }
  });

  _peer.on('connection', function (conn) {
    conn.on('open', function () {
      _peerConns.add(conn);
      _closeRemoteModal();
      // Push current state to the newly connected phone immediately
      if (conn.open) conn.send({
        type:             'stateUpdate',
        playing:          Tone.Transport.state === 'started',
        bpm:              state.cachedBPM,
        animation:        state.animalType,
        direction:        state.bounceDirection,
        beatsPerMeasure:  state.beatsPerMeasure,
        subdivision:      state.subdivision,
        swingEnabled:     state.swingEnabled,
        soundEnabled:     state.animalSoundEnabled,
        accentEnabled:    state.accentEnabled,
        flashEnabled:     state.flashEnabled,
        voiceCountEnabled: state.voiceCountEnabled,
        rockBeatEnabled:  state.rockBeatEnabled,
        waltzBeatEnabled: state.waltzBeatEnabled,
        isFullscreen:     state.isFullscreen,
        circleColor:      state.circleColor,
        countingTrainerEnabled: state.countingTrainerEnabled,
        ctTargetMeasures: state.ctTargetMeasures,
        ctTargetExtraBeats: state.ctTargetExtraBeats,
        ctSoundOn: state.ctSoundOn,
        ctVisualOn: state.ctVisualOn,
        beatNoteValue: state.beatNoteValue,
      });
    });
    conn.on('data', function (data) {
      try {
        var msg = (typeof data === 'string') ? JSON.parse(data) : data;
        applyRemoteCommand(msg);
      } catch (e) {}
    });
    conn.on('close', function () { _peerConns.delete(conn); });
    conn.on('error', function () { _peerConns.delete(conn); });
  });

  _peer.on('error', function (err) {
    console.warn('PeerJS:', err.type);
  });
}

// ── QR code modal ────────────────────────────────────────────────────────────
function showQRModal() {
  var remoteModal     = document.getElementById('remote-modal');
  var singleSection   = document.getElementById('remote-single-section');
  var dualSection     = document.getElementById('remote-dual-section');
  if (!remoteModal) return;

  remoteModal.classList.remove('hidden');

  if (_remoteMode === 'peer') {
    // Pure PeerJS mode (GitHub Pages / static host) — single QR
    var qrContainer = document.getElementById('qr-code');
    var urlEl       = document.getElementById('remote-url');
    var hintEl      = document.getElementById('remote-modal-hint');
    if (singleSection) singleSection.classList.remove('hidden');
    if (dualSection)   dualSection.classList.add('hidden');
    if (hintEl) hintEl.textContent = 'Scan on your phone. Works on any network.';
    if (_peerId) {
      var peerUrl = location.origin + '/remote.html?p=' + _peerId;
      if (qrContainer) _renderQR(qrContainer, peerUrl);
      if (urlEl) urlEl.textContent = peerUrl;
    } else {
      if (urlEl) urlEl.textContent = 'Connecting to PeerJS\u2026 please wait a moment.';
    }
  } else if (_remoteMode === 'ws') {
    // WS mode — show two QR codes: local-network (WS) + any-network (PeerJS backup)
    if (singleSection) singleSection.classList.add('hidden');
    if (dualSection)   dualSection.classList.remove('hidden');
    var wsQrEl    = document.getElementById('qr-code-ws');
    var wsUrlEl   = document.getElementById('remote-url-ws');
    var peerQrEl  = document.getElementById('qr-code-peer');
    var peerUrlEl = document.getElementById('remote-url-peer');

    fetch('/api/info')
      .then(function (r) { return r.json(); })
      .then(function (info) {
        var wsUrl = 'http://' + info.ip + ':' + info.port + '/remote.html';
        if (wsQrEl)  _renderQR(wsQrEl, wsUrl);
        if (wsUrlEl) wsUrlEl.textContent = wsUrl;
      })
      .catch(function () {
        if (wsUrlEl) wsUrlEl.textContent = 'Could not reach server \u2014 is node server.js running?';
      });

    if (_peerId) {
      var pUrl = location.origin + '/remote.html?p=' + _peerId;
      if (peerQrEl)  _renderQR(peerQrEl, pUrl);
      if (peerUrlEl) peerUrlEl.textContent = pUrl;
    } else {
      if (peerUrlEl) peerUrlEl.textContent = 'Connecting\u2026 please reopen this dialog in a moment.';
    }
  }
}

// ── Modal helpers ─────────────────────────────────────────────────────────────
function _closeRemoteModal() {
  var el = document.getElementById('remote-modal');
  if (el) el.classList.add('hidden');
}

// ── State broadcast ───────────────────────────────────────────────────────────
export function sendStateUpdate() {
  // Note: this local was named `state` in the original script.js; renamed to
  // avoid shadowing the shared `state` module object read below.
  var payload = {
    type:             'stateUpdate',
    playing:          Tone.Transport.state === 'started',
    bpm:              state.cachedBPM,
    animation:        state.animalType,
    direction:        state.bounceDirection,
    beatsPerMeasure:  state.beatsPerMeasure,
    subdivision:      state.subdivision,
    swingEnabled:     state.swingEnabled,
    soundEnabled:     state.animalSoundEnabled,
    accentEnabled:    state.accentEnabled,
    flashEnabled:     state.flashEnabled,
    voiceCountEnabled: state.voiceCountEnabled,
    rockBeatEnabled:  state.rockBeatEnabled,
    waltzBeatEnabled: state.waltzBeatEnabled,
    isFullscreen:     state.isFullscreen,
    circleColor:      state.circleColor,
    bluetoothDelay:   state.bluetoothDelay,
    countingTrainerEnabled: state.countingTrainerEnabled,
    ctTargetMeasures: state.ctTargetMeasures,
    ctTargetExtraBeats: state.ctTargetExtraBeats,
    ctSoundOn: state.ctSoundOn,
    ctVisualOn: state.ctVisualOn,
    beatNoteValue: state.beatNoteValue,
  };
  if (_remoteMode === 'ws' && _remoteWS && _remoteWS.readyState === WebSocket.OPEN) {
    _remoteWS.send(JSON.stringify(payload));
  }
  // Send to any active PeerJS connections regardless of primary transport mode.
  // In WS mode, PeerJS runs as a backup for restricted networks (e.g. school WiFi).
  _peerConns.forEach(function (conn) {
    if (conn.open) conn.send(payload);
  });
}

// ── Command handler (shared by both transports) ───────────────────────────────
function applyRemoteCommand(msg) {
  // Any message from the phone means it's connected — dismiss the QR modal
  _closeRemoteModal();

  switch (msg.type) {
    case 'play':
      if (Tone.Transport.state !== 'started') {
        _ensureAudioContext(function () { toggleTransport(false); });
      }
      break;

    case 'playWithCountIn1':
      if (Tone.Transport.state !== 'started') {
        _ensureAudioContext(function () { toggleTransport(1); });
      }
      break;

    case 'playWithCountIn':
      if (Tone.Transport.state !== 'started') {
        _ensureAudioContext(function () { toggleTransport(2); });
      }
      break;

    case 'stop':
      if (Tone.Transport.state === 'started') {
        toggleTransport(false);
      }
      break;

    case 'setBPM': {
      applyBPM(Math.round(msg.bpm));
      break;
    }

    case 'setAnimation': {
      var val = msg.value;
      if (['circle', 'conductor', 'conductor3d', 'score'].indexOf(val) === -1) break;
      state.animalType = val;
      var selector = document.getElementById('animal-selector');
      if (selector) selector.value = val;
      updateColorPickerVisibility();
      createAnimals();
      _sync3DConductor();
      _syncWebGPUCanvas();
      _syncNotationDisplay();
      _syncAnimSize();
      _syncPracticeRow();
      sendStateUpdate();
      break;
    }

    case 'setDirection': {
      var dir = msg.value;
      if (dir !== 'horizontal' && dir !== 'vertical') break;
      state.bounceDirection = dir;
      var dirSel = document.getElementById('bounce-direction');
      if (dirSel) dirSel.value = dir;
      sendStateUpdate();
      break;
    }

    case 'setBeatsPerMeasure': {
      var bpm = parseInt(msg.value);
      if (bpm < 1 || bpm > 9 || isNaN(bpm)) break;
      state.beatsPerMeasure = bpm;
      state.currentBeat = 0;
      var tsSel = document.getElementById('time-signature');
      if (tsSel) tsSel.value = bpm;
      // Auto-disable rock beat if not 4/4
      if (bpm !== 4 && state.rockBeatEnabled) {
        state.rockBeatEnabled = false;
        var rbCb = document.getElementById('rock-beat-enabled');
        if (rbCb) rbCb.checked = false;
      }
      var rbGroup = document.getElementById('rock-beat-setting-group');
      if (rbGroup) rbGroup.style.display = bpm === 4 ? '' : 'none';
      // Auto-disable waltz beat if not 3/4
      if (bpm !== 3 && state.waltzBeatEnabled) {
        state.waltzBeatEnabled = false;
        var wbCb = document.getElementById('waltz-beat-enabled');
        if (wbCb) wbCb.checked = false;
      }
      var wbGroup = document.getElementById('waltz-beat-setting-group');
      if (wbGroup) wbGroup.style.display = bpm === 3 ? '' : 'none';
      if (state.animalType === 'score') crRenderNotationDisplay();
      sendStateUpdate();
      break;
    }

    case 'setSubdivision': {
      var sub = msg.value;
      if (['none', '2', '3', '4', '5', '6', '7'].indexOf(sub) === -1) break;
      state.subdivision = sub;
      var subSel = document.getElementById('subdivision');
      if (subSel) subSel.value = sub;
      // Update swing visibility and auto-disable if leaving ÷2
      var swingGrp = document.getElementById('swing-group');
      if (swingGrp) swingGrp.style.display = (sub === '2') ? '' : 'none';
      if (sub !== '2' && state.swingEnabled) {
        state.swingEnabled = false;
        var swCb = document.getElementById('swing-enabled');
        if (swCb) swCb.checked = false;
      }
      sendStateUpdate();
      break;
    }

    case 'setSwingEnabled': {
      state.swingEnabled = !!msg.value;
      var swingCb2 = document.getElementById('swing-enabled');
      if (swingCb2) swingCb2.checked = state.swingEnabled;
      sendStateUpdate();
      break;
    }

    case 'setSoundEnabled': {
      state.animalSoundEnabled = !!msg.value;
      var sndCb = document.getElementById('animal-sound-enabled');
      if (sndCb) sndCb.checked = state.animalSoundEnabled;
      sendStateUpdate();
      break;
    }

    case 'setAccentEnabled': {
      state.accentEnabled = !!msg.value;
      var accCb = document.getElementById('accent-enabled');
      if (accCb) accCb.checked = state.accentEnabled;
      sendStateUpdate();
      break;
    }

    case 'setFlashEnabled': {
      state.flashEnabled = !!msg.value;
      var flCb = document.getElementById('flash-enabled');
      if (flCb) flCb.checked = state.flashEnabled;
      sendStateUpdate();
      break;
    }

    case 'setVoiceCountEnabled': {
      state.voiceCountEnabled = !!msg.value;
      var vcCb = document.getElementById('voice-count-enabled');
      if (vcCb) vcCb.checked = state.voiceCountEnabled;
      sendStateUpdate();
      break;
    }

    case 'setRockBeatEnabled': {
      if (state.beatsPerMeasure !== 4) break;
      state.rockBeatEnabled = !!msg.value;
      var rbCb2 = document.getElementById('rock-beat-enabled');
      if (rbCb2) rbCb2.checked = state.rockBeatEnabled;
      sendStateUpdate();
      break;
    }

    case 'setWaltzBeatEnabled': {
      if (state.beatsPerMeasure !== 3) break;
      state.waltzBeatEnabled = !!msg.value;
      var wbCb2 = document.getElementById('waltz-beat-enabled');
      if (wbCb2) wbCb2.checked = state.waltzBeatEnabled;
      sendStateUpdate();
      break;
    }

    case 'toggleFullscreen': {
      if (state.isFullscreen) {
        exitFullscreen();
      } else {
        enterFullscreen();
      }
      sendStateUpdate();
      break;
    }

    case 'setCircleColor': {
      var c = msg.value;
      if (typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c)) {
        state.circleColor = c;
        var cp = document.getElementById('circle-color');
        if (cp) cp.value = c;
        sendStateUpdate();
      }
      break;
    }

    case 'setBluetoothDelay': {
      var bd = parseInt(msg.value, 10);
      if (!isNaN(bd) && bd >= 0 && bd <= 500) {
        state.bluetoothDelay = bd;
        var bdSlider = document.getElementById('bluetooth-delay-slider');
        var bdValue  = document.getElementById('bluetooth-delay-value');
        if (bdSlider) bdSlider.value = bd;
        if (bdValue)  bdValue.textContent = bd;
        sendStateUpdate();
      }
      break;
    }

    case 'setCountingTrainerEnabled': {
      state.countingTrainerEnabled = !!msg.value;
      var ctCb = document.getElementById('ct-enabled');
      if (ctCb) ctCb.checked = state.countingTrainerEnabled;
      var ctBtnEl = document.getElementById('counting-trainer-btn');
      if (ctBtnEl) ctBtnEl.classList.toggle('ct-active', state.countingTrainerEnabled);
      sendStateUpdate();
      break;
    }

    case 'setCtTargetMeasures': {
      var m = parseInt(msg.value);
      if (!isNaN(m) && m >= 1 && m <= 99) {
        state.ctTargetMeasures = m;
        var ctMIn = document.getElementById('ct-measures');
        if (ctMIn) ctMIn.value = m;
        sendStateUpdate();
      }
      break;
    }

    case 'setCtTargetExtraBeats': {
      var b = parseInt(msg.value);
      if (!isNaN(b) && b >= 0 && b <= 8) {
        state.ctTargetExtraBeats = b;
        var ctBIn = document.getElementById('ct-extra-beats');
        if (ctBIn) ctBIn.value = b;
        sendStateUpdate();
      }
      break;
    }

    case 'setCtSoundOn': {
      state.ctSoundOn = !!msg.value;
      var ctSCb = document.getElementById('ct-sound-on');
      if (ctSCb) ctSCb.checked = state.ctSoundOn;
      sendStateUpdate();
      break;
    }

    case 'setCtVisualOn': {
      state.ctVisualOn = !!msg.value;
      var ctVCb = document.getElementById('ct-visual-on');
      if (ctVCb) ctVCb.checked = state.ctVisualOn;
      sendStateUpdate();
      break;
    }

    case 'requestState':
      sendStateUpdate();
      break;

    case 'setBeatNoteValue': {
      var bnv = msg.value;
      if (['q', 'h', 'e', 'dq'].indexOf(bnv) === -1) break;
      state.beatNoteValue = bnv;
      _syncBeatNoteRow();
      if (state.animalType === 'score') {
        crRenderNotationDisplay();
        crRenderNotation();
      }
      sendStateUpdate();
      break;
    }
  }
}
