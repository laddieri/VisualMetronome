import { state } from './state.js';
import { createAnimals } from './animations.js';
import { crRenderNotationDisplay } from './custom-rhythm.js';

var cameraStream = null;
var cameraFacingMode = 'user'; // 'user' (front) or 'environment' (rear)
var recordedSoundURL = null; // URL for recorded selfie sound
var recordedSoundPlayer = null; // Tone.js Player for recorded sound
var mediaRecorder = null;
var audioChunks = [];


// Camera functions
function startCameraStream(video) {
  if (cameraStream) {
    cameraStream.getTracks().forEach(track => track.stop());
    cameraStream = null;
  }
  // Null srcObject first — required by iOS Safari before reassigning
  video.srcObject = null;
  video.classList.toggle('rear-camera', cameraFacingMode === 'environment');

  function tryGetUserMedia(constraints) {
    return navigator.mediaDevices.getUserMedia({ video: constraints })
      .then(stream => { cameraStream = stream; video.srcObject = stream; });
  }

  // Use exact facingMode so browsers can't silently fall back to the wrong camera.
  // If exact isn't supported, retry with a soft preference.
  return tryGetUserMedia({
    facingMode: { exact: cameraFacingMode },
    width: { ideal: 640 },
    height: { ideal: 480 }
  }).catch(() => tryGetUserMedia({
    facingMode: cameraFacingMode,
    width: { ideal: 640 },
    height: { ideal: 480 }
  }));
}

export function openCamera() {
  const modal = document.getElementById('camera-modal');
  const video = document.getElementById('camera-video');

  modal.classList.remove('hidden');
  renderSavedSelfiesList();

  startCameraStream(video).catch(err => {
    console.error('Camera access denied:', err);
    alert('Could not access camera. Please allow camera access and try again.');
    closeCamera();
  });
}

function switchCamera() {
  cameraFacingMode = cameraFacingMode === 'user' ? 'environment' : 'user';
  const video = document.getElementById('camera-video');
  startCameraStream(video).catch(err => {
    // Roll back if the requested facing mode isn't available
    cameraFacingMode = cameraFacingMode === 'user' ? 'environment' : 'user';
    console.warn('Could not switch camera:', err);
  });
}

function closeCamera() {
  const modal = document.getElementById('camera-modal');
  const video = document.getElementById('camera-video');

  modal.classList.add('hidden');

  if (cameraStream) {
    cameraStream.getTracks().forEach(track => track.stop());
    cameraStream = null;
  }
  video.srcObject = null;
  cameraFacingMode = 'user';
}

function capturePhoto() {
  const video = document.getElementById('camera-video');

  // Create a canvas to capture the frame
  const captureCanvas = document.createElement('canvas');
  const size = Math.min(video.videoWidth, video.videoHeight);
  captureCanvas.width = size;
  captureCanvas.height = size;

  const ctx = captureCanvas.getContext('2d');

  // Calculate crop to get square from center
  const offsetX = (video.videoWidth - size) / 2;
  const offsetY = (video.videoHeight - size) / 2;

  // Draw the center square of the video
  ctx.drawImage(video, offsetX, offsetY, size, size, 0, 0, size, size);

  // Convert to p5.js image and route to the right target
  const dataURL = captureCanvas.toDataURL('image/png');
  if (state.cameraTarget === 'conductor') {
    state.conductorSelfieImage = loadImage(dataURL);
  } else {
    state.selfieImageDataURL = dataURL;
    state.selfieImage = loadImage(dataURL, () => {
      // Image loaded, recreate animals to use it
      createAnimals();
    });
  }

  closeCamera();
}

// Sound recording functions
var isCountingDown = false; // Track if countdown is in progress

function startRecording() {
  const recordBtn = document.getElementById('record-sound-btn');
  const recordingStatus = document.getElementById('recording-status');

  // Prevent starting if already counting down
  if (isCountingDown) return;

  // Start countdown
  isCountingDown = true;
  recordBtn.disabled = true;
  recordBtn.textContent = '3...';
  recordingStatus.textContent = 'Get ready...';
  recordingStatus.classList.add('recording');

  setTimeout(() => {
    recordBtn.textContent = '2...';
  }, 1000);

  setTimeout(() => {
    recordBtn.textContent = '1...';
  }, 2000);

  // After 3 seconds, start actual recording
  setTimeout(() => {
    isCountingDown = false;
    recordBtn.disabled = false;
    actuallyStartRecording();
  }, 3000);
}

// Trim silence from beginning and end of audio buffer
async function trimSilence(audioBlob) {
  const arrayBuffer = await audioBlob.arrayBuffer();
  const audioContext = new (window.AudioContext || window.webkitAudioContext)();

  try {
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    const channelData = audioBuffer.getChannelData(0); // Get first channel
    const sampleRate = audioBuffer.sampleRate;

    // Find first non-silent sample (threshold-based)
    const threshold = 0.01; // Adjust sensitivity
    let startSample = 0;
    let endSample = channelData.length - 1;

    // Find start (first sample above threshold)
    for (let i = 0; i < channelData.length; i++) {
      if (Math.abs(channelData[i]) > threshold) {
        // Add small buffer before sound (50ms)
        startSample = Math.max(0, i - Math.floor(sampleRate * 0.05));
        break;
      }
    }

    // Find end (last sample above threshold)
    for (let i = channelData.length - 1; i >= 0; i--) {
      if (Math.abs(channelData[i]) > threshold) {
        // Add small buffer after sound (100ms)
        endSample = Math.min(channelData.length - 1, i + Math.floor(sampleRate * 0.1));
        break;
      }
    }

    // Create trimmed buffer
    const trimmedLength = endSample - startSample + 1;
    const trimmedBuffer = audioContext.createBuffer(
      audioBuffer.numberOfChannels,
      trimmedLength,
      sampleRate
    );

    // Copy trimmed data to new buffer
    for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
      const sourceData = audioBuffer.getChannelData(channel);
      const destData = trimmedBuffer.getChannelData(channel);
      for (let i = 0; i < trimmedLength; i++) {
        destData[i] = sourceData[startSample + i];
      }
    }

    // Convert back to blob (WAV format for better compatibility)
    const wavBlob = audioBufferToWav(trimmedBuffer);
    audioContext.close();
    return wavBlob;
  } catch (err) {
    console.error('Error trimming audio:', err);
    audioContext.close();
    return audioBlob; // Return original if trimming fails
  }
}

// Convert AudioBuffer to WAV Blob
function audioBufferToWav(buffer) {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;

  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;

  const dataLength = buffer.length * blockAlign;
  const bufferLength = 44 + dataLength;

  const arrayBuffer = new ArrayBuffer(bufferLength);
  const view = new DataView(arrayBuffer);

  // Write WAV header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(view, 36, 'data');
  view.setUint32(40, dataLength, true);

  // Write audio data
  const offset = 44;
  const channelData = [];
  for (let i = 0; i < numChannels; i++) {
    channelData.push(buffer.getChannelData(i));
  }

  for (let i = 0; i < buffer.length; i++) {
    for (let channel = 0; channel < numChannels; channel++) {
      const sample = Math.max(-1, Math.min(1, channelData[channel][i]));
      const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
      view.setInt16(offset + (i * blockAlign) + (channel * bytesPerSample), intSample, true);
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

function writeString(view, offset, string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

function actuallyStartRecording() {
  const recordBtn = document.getElementById('record-sound-btn');
  const recordingStatus = document.getElementById('recording-status');

  navigator.mediaDevices.getUserMedia({ audio: true })
    .then(stream => {
      audioChunks = [];
      mediaRecorder = new MediaRecorder(stream);

      mediaRecorder.ondataavailable = (e) => {
        audioChunks.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        // Stop the audio stream
        stream.getTracks().forEach(track => track.stop());

        recordingStatus.textContent = 'Processing...';

        // Create audio blob and trim silence
        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
        const trimmedBlob = await trimSilence(audioBlob);

        // Revoke old URL if exists
        if (recordedSoundURL) {
          URL.revokeObjectURL(recordedSoundURL);
        }

        recordedSoundURL = URL.createObjectURL(trimmedBlob);

        // Create Tone.js Player with recorded sound
        if (recordedSoundPlayer) {
          recordedSoundPlayer.dispose();
        }
        recordedSoundPlayer = new Tone.Player(recordedSoundURL).toMaster();

        recordingStatus.textContent = '✓ Sound recorded & trimmed!';
        recordingStatus.classList.remove('recording');
      };

      mediaRecorder.start();
      recordBtn.textContent = '⏹ Stop Recording';
      recordBtn.classList.add('recording');
      recordingStatus.textContent = 'Recording...';
      recordingStatus.classList.add('recording');

      // Auto-stop after 2 seconds for a short sound
      setTimeout(() => {
        if (mediaRecorder && mediaRecorder.state === 'recording') {
          stopRecording();
        }
      }, 2000);
    })
    .catch(err => {
      console.error('Microphone access denied:', err);
      recordingStatus.textContent = 'Microphone access denied';
    });
}

function stopRecording() {
  const recordBtn = document.getElementById('record-sound-btn');

  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
    recordBtn.textContent = '🎤 Record Sound';
    recordBtn.classList.remove('recording');
  }
}

function toggleRecording() {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    stopRecording();
  } else {
    startRecording();
  }
}

// ── Saved Selfies (localStorage) ──────────────────────────────────────────────
var _VM_SELFIES_KEY = 'vm_saved_selfies';

function getSavedSelfies() {
  try { return JSON.parse(localStorage.getItem(_VM_SELFIES_KEY)) || []; }
  catch(e) { return []; }
}

function saveSelfieToStorage(name, imageDataURL, soundDataURL) {
  var selfies = getSavedSelfies();
  selfies.push({
    id: Date.now(),
    name: name,
    image: imageDataURL,
    sound: soundDataURL || null,
    savedAt: new Date().toLocaleDateString()
  });
  localStorage.setItem(_VM_SELFIES_KEY, JSON.stringify(selfies));
}

function deleteSavedSelfie(id) {
  var selfies = getSavedSelfies().filter(function(s) { return s.id !== id; });
  localStorage.setItem(_VM_SELFIES_KEY, JSON.stringify(selfies));
}

function renderSavedSelfiesList() {
  var listEl = document.getElementById('saved-selfies-list');
  if (!listEl) return;
  var selfies = getSavedSelfies();
  if (selfies.length === 0) {
    listEl.innerHTML = '<p class="no-saved-selfies">No saved selfies yet.</p>';
    return;
  }
  listEl.innerHTML = selfies.map(function(s) {
    return '<div class="saved-selfie-item" data-id="' + s.id + '">' +
      '<img src="' + s.image + '" class="saved-selfie-thumb" alt="' + s.name + '">' +
      '<div class="saved-selfie-info">' +
        '<span class="saved-selfie-name">' + s.name + '</span>' +
        '<span class="saved-selfie-date">' + s.savedAt + '</span>' +
        (s.sound ? '<span class="saved-selfie-has-sound">&#127908; sound</span>' : '') +
      '</div>' +
      '<div class="saved-selfie-actions">' +
        '<button class="load-selfie-btn camera-btn" data-id="' + s.id + '">Load</button>' +
        '<button class="delete-selfie-btn camera-btn cancel" data-id="' + s.id + '">&#128465;</button>' +
      '</div>' +
    '</div>';
  }).join('');

  // Attach listeners
  listEl.querySelectorAll('.load-selfie-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var id = parseInt(btn.getAttribute('data-id'), 10);
      loadSavedSelfie(id);
    });
  });
  listEl.querySelectorAll('.delete-selfie-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var id = parseInt(btn.getAttribute('data-id'), 10);
      deleteSavedSelfie(id);
      renderSavedSelfiesList();
    });
  });
}

function loadSavedSelfie(id) {
  var selfies = getSavedSelfies();
  var entry = selfies.find(function(s) { return s.id === id; });
  if (!entry) return;

  // Load image into p5
  state.selfieImageDataURL = entry.image;
  state.selfieImage = loadImage(entry.image, function() {
    createAnimals();
  });

  // Load sound if present
  if (entry.sound) {
    recordedSoundURL = entry.sound;
    if (recordedSoundPlayer) {
      recordedSoundPlayer.dispose();
      recordedSoundPlayer = null;
    }
    recordedSoundPlayer = new Tone.Player(entry.sound).toMaster();
    recordedSoundPlayer.volume.value = 6;
  }

  // Selfie is now a shape option, not an animation type; just reload animals
  createAnimals();
  if (state.animalType === 'score') crRenderNotationDisplay();
  closeCamera();
}

// Initialize camera button listeners
export function initCameraListeners() {
  const captureBtn = document.getElementById('capture-btn');
  const cancelBtn = document.getElementById('cancel-btn');
  const recordBtn = document.getElementById('record-sound-btn');

  if (captureBtn) {
    captureBtn.addEventListener('click', capturePhoto);
  }
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      closeCamera();
      // If selfie shape was selected but no photo was taken, revert to 'ball'
      if (!state.selfieImage && state.notationBallStyle === 'selfie') {
        state.notationBallStyle = 'ball';
        var styleEl = document.getElementById('notation-ball-style');
        if (styleEl) styleEl.value = 'ball';
        createAnimals();
      }
    });
  }
  if (recordBtn) {
    recordBtn.addEventListener('click', toggleRecording);
  }

  const flipBtn = document.getElementById('flip-camera-btn');
  if (flipBtn) {
    flipBtn.addEventListener('click', switchCamera);
  }

  // Mirror selfies checkbox
  const mirrorCheckbox = document.getElementById('mirror-selfies');
  if (mirrorCheckbox) {
    mirrorCheckbox.addEventListener('change', (e) => {
      state.mirrorSelfies = e.target.checked;
    });
  }

  // Save selfie button
  const saveSelfieBtn = document.getElementById('save-selfie-btn');
  if (saveSelfieBtn) {
    saveSelfieBtn.addEventListener('click', function() {
      if (!state.selfieImageDataURL) {
        alert('Take a selfie first before saving.');
        return;
      }
      var nameInput = document.getElementById('selfie-name-input');
      var name = nameInput ? nameInput.value.trim() : '';
      if (!name) name = 'Selfie ' + new Date().toLocaleDateString();
      saveSelfieToStorage(name, state.selfieImageDataURL, recordedSoundURL || null);
      if (nameInput) nameInput.value = '';
      renderSavedSelfiesList();
    });
  }
}
