/* =========================================================
   EduMeet — Tab Recording + Class Code Lock
   ========================================================= */

const $ = (id) => document.getElementById(id);

// Join screen
const joinScreen   = $('join-screen');
const roomInput    = $('room-input');
const nameInput    = $('name-input');
const teacherCheck = $('teacher-check');
const joinBtn      = $('join-btn');
const codeGroup    = $('code-group');
const codeInput    = $('code-input');

// Room screen
const roomScreen    = $('room-screen');
const roomTitle     = $('room-title');
const statusEl      = $('status');
const clockEl       = $('clock');
const recBadge      = $('rec-badge');
const codeBadge     = $('code-badge');
const codeText      = $('code-text');
const localVideo    = $('local-video');
const localName     = $('local-name');
const localMic      = $('local-mic');
const localAvatar   = $('local-avatar');
const localTile     = $('local-tile');
const videoGrid     = $('video-grid');
const mobileMenuBtn = $('mobile-menu-btn');
const panelBackdrop = $('panel-backdrop');

// Controls
const micBtn        = $('mic-btn');
const camBtn        = $('cam-btn');
const flipCamBtn    = $('flip-cam-btn');
const shareBtn      = $('share-btn');
const chatToggle    = $('chat-toggle');
const peopleToggle  = $('people-toggle');
const leaveBtn      = $('leave-btn');
const recordBtn     = $('record-btn');
const stopRecordBtn = $('stop-record-btn');
const muteAllBtn    = $('mute-all-btn');
const camOffAllBtn  = $('cam-off-all-btn');
const lockBtn       = $('lock-btn');
const newcodeBtn    = $('newcode-btn');
const teacherBar    = $('teacher-bar');

// Side panel
const sidePanel    = $('side-panel');
const chatMessages = $('chat-messages');
const chatForm     = $('chat-form');
const chatInput    = $('chat-input');
const chatBadge    = $('chat-badge');
const peopleList   = $('people-list');
const peopleCount  = $('people-count');
const closePanel   = $('close-panel');
const installBtn   = $('install-btn');

// ---- State ----
const socket = io({ autoConnect: false });
let localStream    = null;
let screenStream   = null;
let audioRecorder  = null;
let videoRecorder  = null;
const peers        = {};
const peerVideos   = {};
const peerNames    = {};
const peerStates   = {};
let isTeacher      = false;
let currentRoom    = '';
let userName       = '';
let micOn          = true;
let camOn          = true;
let isSharing      = false;
let isRecording    = false;
let isLocked       = false;
let unreadChat     = 0;
let callStartTime  = null;
let clockTimer     = null;
let currentFacing  = 'user';
let hasMultipleCameras = false;

const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
const canShareScreen = !!(
  navigator.mediaDevices &&
  navigator.mediaDevices.getDisplayMedia &&
  !isMobile
);

// =========================================================
// Show/hide code input based on teacher checkbox
// =========================================================
teacherCheck.addEventListener('change', () => {
  if (teacherCheck.checked) {
    codeGroup.classList.add('hidden');
  } else {
    codeGroup.classList.remove('hidden');
  }
});

// =========================================================
// JOIN
// =========================================================
joinBtn.addEventListener('click', async () => {
  currentRoom = roomInput.value.trim() || 'class-101';
  userName    = nameInput.value.trim() || `user-${Math.floor(Math.random() * 1000)}`;
  isTeacher   = teacherCheck.checked;

  const code = codeInput.value.trim();

  if (!isTeacher && !code) {
    toast('error', 'Please enter the class code');
    return;
  }

  joinBtn.disabled = true;
  joinBtn.textContent = 'Connecting…';

  try {
    localStream = await getMediaStream(currentFacing);
    localVideo.srcObject = localStream;
    localVideo.muted = true;
    try { await localVideo.play(); } catch (e) {}

    localName.textContent = userName + (isTeacher ? ' 👨‍🏫' : '');
    localAvatar.textContent = userName.slice(0, 2).toUpperCase();

    await checkCameraCount();

    socket.connect();
    socket.emit('join-room', {
      roomId: currentRoom,
      userId: userName,
      isTeacher,
      code
    });

    wireSocketEvents();

  } catch (err) {
    console.error('Join error:', err);
    joinBtn.disabled = false;
    joinBtn.textContent = 'Join Class';
    toast('error', 'Camera/mic error: ' + err.message);
  }
});

// =========================================================
// MEDIA HELPERS
// =========================================================
async function getMediaStream(facing = 'user') {
  return navigator.mediaDevices.getUserMedia({
    video: {
      width: { ideal: 1280 }, height: { ideal: 720 },
      facingMode: facing
    },
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    }
  });
}

async function checkCameraCount() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    hasMultipleCameras = devices.filter((d) => d.kind === 'videoinput').length > 1;
  } catch (err) {
    hasMultipleCameras = false;
  }
}

// =========================================================
// SOCKET
// =========================================================
function wireSocketEvents() {
  // ---- Join approved ----
  socket.on('join-approved', () => {
    joinScreen.classList.add('hidden');
    roomScreen.classList.remove('hidden');
    roomTitle.textContent = `Room: ${currentRoom}`;
    setStatus('Connected');

    if (isTeacher) {
      recordBtn.classList.remove('hidden');
      teacherBar.classList.remove('hidden');
    } else {
      recordBtn.classList.add('hidden');
      teacherBar.classList.add('hidden');
    }

    if (!canShareScreen) {
      shareBtn.classList.add('disabled');
      shareBtn.title = 'Screen share works only on desktop';
    }

    if (!hasMultipleCameras) flipCamBtn.style.display = 'none';

    socket.emit('media-state', {
      roomId: currentRoom,
      muted: !micOn,
      cameraOff: !camOn
    });

    startClock();
  });

  // ---- Join denied ----
  socket.on('join-denied', ({ reason }) => {
    toast('error', reason, 6000);
    joinBtn.disabled = false;
    joinBtn.textContent = 'Join Class';
    socket.disconnect();
    if (localStream) {
      localStream.getTracks().forEach((t) => t.stop());
      localStream = null;
    }
  });

  // ---- Teacher: receive class code ----
  socket.on('class-code', ({ code }) => {
    codeText.textContent = code;
    codeBadge.classList.remove('hidden');
    codeBadge.title = 'Click to copy: ' + code;
    console.log('🔑 Class code:', code);
  });

  // ---- Class lock state (everyone) ----
  socket.on('class-lock-state', ({ locked }) => {
    isLocked = locked;
    if (isTeacher && lockBtn) {
      lockBtn.textContent = locked ? '🔒 Unlock' : '🔓 Lock';
    }
    toast('info', locked ? 'Class locked' : 'Class unlocked');
  });

  // ---- Peers ----
  socket.on('existing-users', (users) => {
    users.forEach(({ socketId, userId }) => {
      peerNames[socketId] = userId;
      createPeer(socketId, true);
    });
  });

  socket.on('user-joined', ({ socketId, userId }) => {
    peerNames[socketId] = userId;
    createPeer(socketId, false);
  });

  socket.on('signal', ({ from, data }) => {
    const peer = peers[from];
    if (peer) {
      try { peer.signal(data); } catch (e) { console.error(e); }
    }
  });

  socket.on('user-left', ({ socketId }) => removePeer(socketId));
  socket.on('participants', (list) => renderParticipants(list));
  socket.on('chat-message', (msg) => renderChatMessage(msg));
  socket.on('peer-media-state', ({ socketId, muted, cameraOff }) =>
    updatePeerTileState(socketId, { muted, cameraOff })
  );

  socket.on('force-mute', () => {
    if (micOn) toggleMic(true);
    toast('info', 'Teacher muted you');
  });

  socket.on('force-camera-off', () => {
    if (camOn) toggleCamera(true);
    toast('info', 'Teacher turned off your camera');
  });

  socket.on('recording-started', () => {
    if (!isTeacher) startStudentAudioRecording();
    recBadge.classList.remove('hidden');
    toast('info', 'Recording started');
  });

  socket.on('recording-stopped', () => {
    if (!isTeacher) stopStudentAudioRecording();
    recBadge.classList.add('hidden');
  });

  socket.on('class-end-success', ({ url }) => {
    setStatus('Recording uploaded ✅');
    toast('success', 'Recording ready! Click download below.', 6000);
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noreferrer';
    a.textContent = '📥 Download Recording';
    a.style.cssText =
      'display:block;padding:14px;background:#064e3b;color:#86efac;' +
      'border-radius:8px;margin:12px;text-decoration:none;text-align:center;' +
      'grid-column:1/-1;font-weight:700;font-size:15px;';
    videoGrid.prepend(a);
  });

  socket.on('class-end-error', ({ message }) =>
    toast('error', 'Error: ' + message, 8000)
  );
}

// =========================================================
// WEBRTC
// =========================================================
function createPeer(targetId, initiator) {
  if (peers[targetId]) return;

  const peer = new SimplePeer({
    initiator,
    trickle: false,
    stream: localStream,
    config: {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    }
  });

  peer.on('signal', (data) => {
    socket.emit('signal', { to: targetId, from: socket.id, data });
  });

  peer.on('stream', (remoteStream) => attachRemoteVideo(targetId, remoteStream));
  peer.on('connect', () => console.log('✅ Peer connected:', targetId));
  peer.on('error', (err) => console.error('❌ Peer error:', targetId, err));
  peer.on('close', () => removePeer(targetId));

  peers[targetId] = peer;
}

function attachRemoteVideo(socketId, stream) {
  let tile = document.querySelector(`[data-peer="${socketId}"]`);
  if (!tile) {
    const displayName = peerNames[socketId] || 'Guest';
    const initials = displayName.slice(0, 2).toUpperCase();
    tile = document.createElement('div');
    tile.className = 'tile';
    tile.dataset.peer = socketId;
    tile.innerHTML = `
      <video autoplay playsinline></video>
      <div class="avatar" style="display:none">${escapeHtml(initials)}</div>
      <div class="tile-label">
        <span class="peer-name">${escapeHtml(displayName)}</span>
        <span class="peer-mic">🎤</span>
      </div>
    `;
    videoGrid.appendChild(tile);
    peerVideos[socketId] = tile.querySelector('video');
    updateGridCount();
  }

  const videoEl = peerVideos[socketId];
  if (videoEl.srcObject !== stream) videoEl.srcObject = stream;

  videoEl.muted = true;
  const p = videoEl.play();
  if (p !== undefined) {
    p.then(() => { videoEl.muted = false; }).catch(() => {
      videoEl.muted = true;
      videoEl.play().catch(() => {});
    });
  }

  if (peerStates[socketId]) updatePeerTileState(socketId, peerStates[socketId]);
}

function removePeer(socketId) {
  if (peers[socketId]) {
    peers[socketId].destroy();
    delete peers[socketId];
  }
  const tile = document.querySelector(`[data-peer="${socketId}"]`);
  if (tile) tile.remove();
  delete peerVideos[socketId];
  delete peerNames[socketId];
  delete peerStates[socketId];
  updateGridCount();
}

function updatePeerTileState(socketId, { muted, cameraOff }) {
  const tile = document.querySelector(`[data-peer="${socketId}"]`);
  if (!tile) return;

  if (muted !== undefined) {
    peerStates[socketId] = { ...(peerStates[socketId] || {}), muted };
    const micEl = tile.querySelector('.peer-mic');
    if (micEl) {
      micEl.textContent = muted ? '🔇' : '🎤';
      micEl.classList.toggle('muted', muted);
    }
  }
  if (cameraOff !== undefined) {
    peerStates[socketId] = { ...(peerStates[socketId] || {}), cameraOff };
    const video = tile.querySelector('video');
    const avatar = tile.querySelector('.avatar');
    if (cameraOff) {
      video.style.visibility = 'hidden';
      if (avatar) avatar.style.display = 'grid';
    } else {
      video.style.visibility = 'visible';
      if (avatar) avatar.style.display = 'none';
    }
  }
}

function updateGridCount() {
  const count = videoGrid.querySelectorAll('.tile').length;
  videoGrid.dataset.count = Math.min(count, 6);
}

// =========================================================
// MIC / CAMERA / FLIP / SHARE
// =========================================================
micBtn.addEventListener('click', () => toggleMic());

function toggleMic(forceMute = false) {
  if (!localStream) return;
  const t = localStream.getAudioTracks()[0];
  if (!t) return;
  micOn = forceMute ? false : !micOn;
  t.enabled = micOn;
  micBtn.classList.toggle('active', !micOn);
  micBtn.querySelector('.ctrl-label').textContent = micOn ? 'Mute' : 'Unmute';
  localMic.textContent = micOn ? '🎤' : '🔇';
  localMic.classList.toggle('muted', !micOn);
  socket.emit('media-state', { roomId: currentRoom, muted: !micOn });
}

camBtn.addEventListener('click', () => toggleCamera());

function toggleCamera(forceOff = false) {
  if (!localStream) return;
  const t = localStream.getVideoTracks()[0];
  if (!t) return;
  camOn = forceOff ? false : !camOn;
  t.enabled = camOn;
  camBtn.classList.toggle('active', !camOn);
  camBtn.querySelector('.ctrl-label').textContent = camOn ? 'Camera' : 'Cam Off';
  localAvatar.textContent = userName.slice(0, 2).toUpperCase();
  localAvatar.style.display = camOn ? 'none' : 'grid';
  localVideo.style.visibility = camOn ? 'visible' : 'hidden';
  socket.emit('media-state', { roomId: currentRoom, cameraOff: !camOn });
}

flipCamBtn.addEventListener('click', async () => {
  if (!localStream || !hasMultipleCameras) return;
  const newFacing = currentFacing === 'user' ? 'environment' : 'user';
  try {
    const oldTrack = localStream.getVideoTracks()[0];
    if (oldTrack) oldTrack.stop();
    const newStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: newFacing, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    });
    const newTrack = newStream.getVideoTracks()[0];
    localStream.removeTrack(oldTrack);
    localStream.addTrack(newTrack);
    localVideo.srcObject = localStream;
    try { await localVideo.play(); } catch (e) {}
    Object.values(peers).forEach((peer) => {
      const sender = peer._pc.getSenders().find((s) => s.track?.kind === 'video');
      if (sender) sender.replaceTrack(newTrack);
    });
    currentFacing = newFacing;
    toast('info', `Switched to ${newFacing === 'user' ? 'front' : 'back'} camera`);
  } catch (err) {
    console.error(err);
    toast('error', 'Could not switch camera');
  }
});

shareBtn.addEventListener('click', async () => {
  if (!canShareScreen) {
    toast('info', 'Screen share works only on desktop', 4000);
    return;
  }
  if (isSharing) return stopScreenShare();
  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: { cursor: 'always' },
      audio: false
    });
    const screenTrack = screenStream.getVideoTracks()[0];
    Object.values(peers).forEach((peer) => {
      const sender = peer._pc.getSenders().find((s) => s.track?.kind === 'video');
      if (sender) sender.replaceTrack(screenTrack);
    });
    localVideo.srcObject = screenStream;
    localTile.classList.add('screenshare');
    isSharing = true;
    shareBtn.classList.add('active');
    shareBtn.querySelector('.ctrl-label').textContent = 'Stop';
    socket.emit('media-state', { roomId: currentRoom, sharingScreen: true });
    screenTrack.onended = stopScreenShare;
    toast('info', 'Screen sharing started');
  } catch (err) {
    console.error(err);
    if (err.name !== 'NotAllowedError') toast('error', 'Screen share failed');
  }
});

function stopScreenShare() {
  if (!isSharing) return;
  screenStream.getTracks().forEach((t) => t.stop());
  const camTrack = localStream.getVideoTracks()[0];
  Object.values(peers).forEach((peer) => {
    const sender = peer._pc.getSenders().find((s) => s.track?.kind === 'video');
    if (sender) sender.replaceTrack(camTrack);
  });
  localVideo.srcObject = localStream;
  localTile.classList.remove('screenshare');
  isSharing = false;
  shareBtn.classList.remove('active');
  shareBtn.querySelector('.ctrl-label').textContent = 'Share';
  socket.emit('media-state', { roomId: currentRoom, sharingScreen: false });
  toast('info', 'Screen sharing stopped');
}

// =========================================================
// RECORDING
// =========================================================
recordBtn.addEventListener('click', async () => {
  try {
    let recordingStream = null;
    let cleanupStreams = [];

    const hasDisplayMedia = !!(
      navigator.mediaDevices &&
      navigator.mediaDevices.getDisplayMedia
    );

    if (hasDisplayMedia) {
      toast('info', 'Select "This Tab" and tick "Share tab audio"', 5000);

      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30 },
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      });

      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      const mixedStream = new MediaStream();
      displayStream.getVideoTracks().forEach((t) => mixedStream.addTrack(t));
      displayStream.getAudioTracks().forEach((t) => mixedStream.addTrack(t));
      micStream.getAudioTracks().forEach((t) => mixedStream.addTrack(t));

      recordingStream = mixedStream;
      cleanupStreams = [displayStream, micStream];

      setStatus('🔴 Recording whole tab (desktop mode)');
      toast('success', 'Recording entire tab + mic + system audio', 4000);

    } else {
      toast('info',
        'Mobile: recording your camera + mic (screen record not supported)',
        6000
      );

      if (!localStream) throw new Error('No local stream available');

      const mobileRecStream = new MediaStream();
      localStream.getVideoTracks().forEach((t) => mobileRecStream.addTrack(t));
      localStream.getAudioTracks().forEach((t) => mobileRecStream.addTrack(t));

      recordingStream = mobileRecStream;
      cleanupStreams = [];

      setStatus('🔴 Recording camera + mic (mobile mode)');
      toast('success', 'Recording your camera + mic', 4000);
    }

    startTeacherRecording(recordingStream, cleanupStreams);

    socket.emit('start-recording', { roomId: currentRoom });

    recordBtn.classList.add('hidden');
    stopRecordBtn.classList.remove('hidden');
    recBadge.classList.remove('hidden');

  } catch (err) {
    console.error('Recording start error:', err);
    if (err.name === 'NotAllowedError') {
      toast('info', 'Recording cancelled', 4000);
    } else {
      toast('error', 'Recording failed: ' + err.message, 6000);
    }
  }
});

function startTeacherRecording(stream, cleanupStreams) {
  if (isRecording) return;

  const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
    ? 'video/webm;codecs=vp9,opus'
    : 'video/webm';

  videoRecorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: 2500000,
    audioBitsPerSecond: 128000
  });

  const chunks = [];

  videoRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  videoRecorder.onstop = async () => {
    const blob = new Blob(chunks, { type: mimeType });
    const sizeMB = (blob.size / 1024 / 1024).toFixed(2);
    console.log(`📤 Teacher recording ready: ${sizeMB} MB`);
    setStatus('Uploading teacher recording…');

    const buf = await blob.arrayBuffer();
    socket.emit('recording-chunk', {
      roomId: currentRoom,
      userId: userName,
      chunk: buf,
      timestamp: Date.now()
    });

    cleanupStreams.forEach((s) => {
      try { s.getTracks().forEach((t) => t.stop()); } catch (e) {}
    });
  };

  videoRecorder.start();
  isRecording = true;
  console.log('🎬 Teacher recording started');
}

function startStudentAudioRecording() {
  if (isRecording || !localStream) return;
  const audioTrack = localStream.getAudioTracks()[0];
  if (!audioTrack) return;

  const audioOnlyStream = new MediaStream([audioTrack]);
  const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : 'audio/webm';

  audioRecorder = new MediaRecorder(audioOnlyStream, { mimeType });

  const chunks = [];

  audioRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  audioRecorder.onstop = async () => {
    const blob = new Blob(chunks, { type: mimeType });
    const sizeKB = (blob.size / 1024).toFixed(1);
    console.log(`📤 Student audio ready: ${sizeKB} KB`);

    const buf = await blob.arrayBuffer();
    socket.emit('audio-chunk', {
      roomId: currentRoom,
      userId: userName,
      chunk: buf,
      timestamp: Date.now()
    });
  };

  audioRecorder.start();
  isRecording = true;
  console.log('🎙 Student audio recording started');
}

function stopStudentAudioRecording() {
  if (audioRecorder && audioRecorder.state !== 'inactive') {
    audioRecorder.stop();
  }
  isRecording = false;
}

stopRecordBtn.addEventListener('click', () => {
  if (videoRecorder && videoRecorder.state !== 'inactive') {
    videoRecorder.stop();
  }
  isRecording = false;

  socket.emit('stop-recording', { roomId: currentRoom });

  stopRecordBtn.classList.add('hidden');
  recordBtn.classList.remove('hidden');
  recBadge.classList.add('hidden');
  setStatus('Merging & uploading… (may take 1-3 minutes)');

  const emails = prompt('Enter student emails (comma-separated) — optional:') || '';

  setTimeout(() => {
    socket.emit('class-end', {
      roomId: currentRoom,
      className: `Class ${currentRoom}`,
      studentEmails: emails.split(',').map((e) => e.trim()).filter(Boolean)
    });
  }, 3000);
});

// =========================================================
// TEACHER CONTROLS
// =========================================================
muteAllBtn.addEventListener('click', () => {
  socket.emit('mute-all', { roomId: currentRoom });
  toast('info', 'All participants muted');
});

camOffAllBtn.addEventListener('click', () => {
  socket.emit('camera-off-all', { roomId: currentRoom });
  toast('info', 'All cameras turned off');
});

lockBtn.addEventListener('click', () => {
  const newLocked = !isLocked;
  socket.emit('lock-class', { roomId: currentRoom, locked: newLocked });
});

newcodeBtn.addEventListener('click', () => {
  if (!confirm('Generate a new code? Current code will stop working.')) return;
  socket.emit('regenerate-code', { roomId: currentRoom });
  toast('info', 'New code generated');
});

codeBadge.addEventListener('click', async () => {
  const code = codeText.textContent;
  if (!code || code === '------') return;
  try {
    await navigator.clipboard.writeText(code);
    toast('success', 'Code copied: ' + code);
  } catch (e) {
    toast('info', 'Code: ' + code);
  }
});

// =========================================================
// SIDE PANEL
// =========================================================
chatToggle.addEventListener('click', () => togglePanel('chat'));
peopleToggle.addEventListener('click', () => togglePanel('people'));
mobileMenuBtn.addEventListener('click', () => togglePanel('chat'));
closePanel.addEventListener('click', () => closeSidePanel());

document.querySelectorAll('.panel-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.panel-tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    const target = tab.dataset.tab;
    $('tab-chat').classList.toggle('hidden', target !== 'chat');
    $('tab-people').classList.toggle('hidden', target !== 'people');
    if (target === 'chat') {
      unreadChat = 0;
      chatBadge.classList.add('hidden');
    }
  });
});

function togglePanel(tab) {
  const isHidden = sidePanel.classList.contains('hidden');
  if (isHidden) {
    sidePanel.classList.remove('hidden');
    document.querySelectorAll('.panel-tab').forEach((t) => {
      t.classList.toggle('active', t.dataset.tab === tab);
    });
    $('tab-chat').classList.toggle('hidden', tab !== 'chat');
    $('tab-people').classList.toggle('hidden', tab !== 'people');
    if (tab === 'chat') { unreadChat = 0; chatBadge.classList.add('hidden'); }
  } else {
    if (tab) {
      document.querySelectorAll('.panel-tab').forEach((t) => {
        t.classList.toggle('active', t.dataset.tab === tab);
      });
      $('tab-chat').classList.toggle('hidden', tab !== 'chat');
      $('tab-people').classList.toggle('hidden', tab !== 'people');
    } else sidePanel.classList.add('hidden');
  }
  syncBackdrop();
}

function closeSidePanel() { sidePanel.classList.add('hidden'); syncBackdrop(); }

function syncBackdrop() {
  const mobile = window.innerWidth <= 900;
  if (mobile && !sidePanel.classList.contains('hidden')) {
    panelBackdrop.classList.remove('hidden');
  } else {
    panelBackdrop.classList.add('hidden');
  }
}

panelBackdrop.addEventListener('click', () => closeSidePanel());
window.addEventListener('resize', syncBackdrop);

chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;
  socket.emit('chat-message', { roomId: currentRoom, userId: userName, text });
  chatInput.value = '';
});

function renderChatMessage(msg) {
  const div = document.createElement('div');
  if (msg.system) {
    div.className = 'chat-msg system';
    div.textContent = msg.text;
  } else {
    div.className = 'chat-msg';
    const isSelf = msg.userId === userName;
    div.innerHTML = `
      <div class="chat-author ${isSelf ? 'self' : ''}">${escapeHtml(msg.userId)}</div>
      <div class="chat-text">${escapeHtml(msg.text)}</div>
    `;
    if (!isSelf && sidePanel.classList.contains('hidden')) {
      unreadChat++;
      chatBadge.textContent = unreadChat;
      chatBadge.classList.remove('hidden');
    }
  }
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function renderParticipants(list) {
  peopleCount.textContent = list.length;
  peopleList.innerHTML = list.map((p) => {
    const initials = (p.userId || '?').slice(0, 2).toUpperCase();
    const isYou = p.userId === userName;
    return `
      <div class="person">
        <div class="person-avatar">${initials}</div>
        <div class="person-name ${isYou ? 'you' : ''}">${escapeHtml(p.userId)}</div>
        ${p.isTeacher ? '<span class="person-role">HOST</span>' : ''}
        <div class="person-icons">
          ${p.muted ? '🔇' : '🎤'}
          ${p.cameraOff ? '📵' : '📷'}
          ${p.sharingScreen ? '🖥️' : ''}
        </div>
      </div>
    `;
  }).join('');
}

// =========================================================
// LEAVE
// =========================================================
leaveBtn.addEventListener('click', () => {
  if (!confirm('Leave the meeting?')) return;
  if (videoRecorder && videoRecorder.state !== 'inactive') videoRecorder.stop();
  if (audioRecorder && audioRecorder.state !== 'inactive') audioRecorder.stop();
  socket.disconnect();
  if (localStream) localStream.getTracks().forEach((t) => t.stop());
  if (screenStream) screenStream.getTracks().forEach((t) => t.stop());
  location.reload();
});

// =========================================================
// HELPERS
// =========================================================
function setStatus(text) { statusEl.textContent = text; }

function startClock() {
  callStartTime = Date.now();
  clockTimer = setInterval(() => {
    const s = Math.floor((Date.now() - callStartTime) / 1000);
    const m = Math.floor(s / 60);
    clockEl.textContent = `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }, 1000);
}

function toast(type, text, duration = 3000) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = text;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateX(20px)';
    el.style.transition = 'all 0.2s';
    setTimeout(() => el.remove(), 200);
  }, duration);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// =========================================================
// PWA
// =========================================================
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  installBtn.classList.remove('hidden');
});
installBtn.addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  installBtn.classList.add('hidden');
});
window.addEventListener('appinstalled', () => {
  installBtn.classList.add('hidden');
  toast('success', 'Elite Meet installed!');
});

updateGridCount();
syncBackdrop();