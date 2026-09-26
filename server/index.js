require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const { handleRecordingChunk, handleAudioChunk } = require('./recording-handler');
const { mergeRoomRecordings } = require('./ffmpeg-merger');
const { uploadRecording } = require('./uploader');
const { sendRecordingEmail } = require('./mailer');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  maxHttpBufferSize: 1e8
});

// rooms: roomId -> Map(socketId -> { userId, isTeacher, muted, cameraOff, sharingScreen })
const rooms = new Map();

// class codes: roomId -> 6-digit code
const classCodes = new Map();

// locked rooms: Set of roomIds
const lockedRooms = new Set();

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

io.on('connection', (socket) => {
  console.log('✅ Connected:', socket.id);

  // ======================================================
  // JOIN ROOM (teacher generates code, student verifies)
  // ======================================================
  socket.on('join-room', ({ roomId, userId, isTeacher, code }) => {
    // ---- Teacher: generate or return existing code ----
    if (isTeacher) {
      if (!classCodes.has(roomId)) {
        const newCode = generateCode();
        classCodes.set(roomId, newCode);
        console.log(`🔑 Generated code for ${roomId}: ${newCode}`);
      }
      socket.emit('class-code', { code: classCodes.get(roomId) });
    } else {
      // ---- Student: verify code ----
      const expected = classCodes.get(roomId);

      if (!expected) {
        socket.emit('join-denied', {
          reason: 'Class has not started yet. Please wait for the teacher.'
        });
        return;
      }

      if (lockedRooms.has(roomId)) {
        socket.emit('join-denied', {
          reason: 'Class is locked by the teacher.'
        });
        return;
      }

      if (!code || String(code).trim() !== expected) {
        socket.emit('join-denied', {
          reason: 'Invalid code. Please ask the teacher for the correct code.'
        });
        return;
      }
    }

    // ---- All checks passed — proceed ----
    socket.join(roomId);
    socket.userId = userId;
    socket.roomId = roomId;
    socket.isTeacher = !!isTeacher;

    if (!rooms.has(roomId)) rooms.set(roomId, new Map());
    const room = rooms.get(roomId);
    room.set(socket.id, {
      userId,
      isTeacher: socket.isTeacher,
      muted: false,
      cameraOff: false,
      sharingScreen: false
    });

    broadcastParticipants(roomId);

    // Send existing users with usernames to the new joiner
    const existing = [...room.entries()]
      .filter(([id]) => id !== socket.id)
      .map(([id, info]) => ({ socketId: id, userId: info.userId }));

    socket.emit('existing-users', existing);

    // Tell others about the new user
    socket.to(roomId).emit('user-joined', {
      socketId: socket.id,
      userId
    });

    io.to(roomId).emit('chat-message', {
      system: true,
      text: `${userId} joined the meeting`,
      ts: Date.now()
    });

    // Confirm to client
    socket.emit('join-approved');
  });

  // ======================================================
  // SIGNALING
  // ======================================================
  socket.on('signal', ({ to, from, data }) => {
    io.to(to).emit('signal', { from, data });
  });

  // ======================================================
  // CHAT
  // ======================================================
  socket.on('chat-message', ({ roomId, userId, text }) => {
    io.to(roomId).emit('chat-message', { userId, text, ts: Date.now() });
  });

  // ======================================================
  // MEDIA STATE (mute / camera / share)
  // ======================================================
  socket.on('media-state', ({ roomId, muted, cameraOff, sharingScreen }) => {
    const room = rooms.get(roomId);
    if (!room || !room.has(socket.id)) return;

    const p = room.get(socket.id);
    if (muted !== undefined) p.muted = muted;
    if (cameraOff !== undefined) p.cameraOff = cameraOff;
    if (sharingScreen !== undefined) p.sharingScreen = sharingScreen;

    io.to(roomId).emit('peer-media-state', {
      socketId: socket.id,
      muted: p.muted,
      cameraOff: p.cameraOff
    });

    broadcastParticipants(roomId);
  });

  // ======================================================
  // TEACHER: mute all / camera off all
  // ======================================================
  socket.on('mute-all', ({ roomId }) => {
    if (!socket.isTeacher) return;
    io.to(roomId).emit('force-mute');
  });

  socket.on('camera-off-all', ({ roomId }) => {
    if (!socket.isTeacher) return;
    io.to(roomId).emit('force-camera-off');
  });

  // ======================================================
  // TEACHER: lock / unlock class
  // ======================================================
  socket.on('lock-class', ({ roomId, locked }) => {
    if (!socket.isTeacher) return;
    if (locked) {
      lockedRooms.add(roomId);
      console.log(`🔒 Locked: ${roomId}`);
    } else {
      lockedRooms.delete(roomId);
      console.log(`🔓 Unlocked: ${roomId}`);
    }
    io.to(roomId).emit('class-lock-state', { locked });
  });

  // ======================================================
  // TEACHER: regenerate code
  // ======================================================
  socket.on('regenerate-code', ({ roomId }) => {
    if (!socket.isTeacher) return;
    const newCode = generateCode();
    classCodes.set(roomId, newCode);
    socket.emit('class-code', { code: newCode });
    console.log(`🔑 Regenerated code for ${roomId}: ${newCode}`);
  });

  // ======================================================
  // RECORDING
  // ======================================================
  handleRecordingChunk(socket);
  handleAudioChunk(socket);

  socket.on('start-recording', ({ roomId }) => {
    if (!socket.isTeacher) return;
    console.log(`🎬 Recording started in ${roomId}`);
    socket.to(roomId).emit('recording-started');
  });

  socket.on('stop-recording', ({ roomId }) => {
    if (!socket.isTeacher) return;
    console.log(`⏹ Recording stopped in ${roomId}`);
    socket.to(roomId).emit('recording-stopped');
  });

  socket.on('class-end', async ({ roomId, className, studentEmails }) => {
    try {
      console.log(`🎬 Class ended: ${roomId}. Merging...`);
      const videoPath = await mergeRoomRecordings(roomId);
      console.log('📦 Merged:', videoPath);

      const publicUrl = await uploadRecording(videoPath, roomId);
      console.log('☁️  Uploaded:', publicUrl);

      await sendRecordingEmail(studentEmails, publicUrl, className);
      console.log('📧 Emails sent');

      socket.emit('class-end-success', { url: publicUrl });
      io.to(roomId).emit('chat-message', {
        system: true,
        text: `Recording available: ${publicUrl}`,
        ts: Date.now()
      });
    } catch (err) {
      console.error('❌ Class end error:', err);
      socket.emit('class-end-error', { message: err.message });
    }
  });

  // ======================================================
  // DISCONNECT
  // ======================================================
  socket.on('disconnect', () => {
    const { roomId, userId } = socket;
    if (roomId && rooms.has(roomId)) {
      rooms.get(roomId).delete(socket.id);

      if (rooms.get(roomId).size === 0) {
        rooms.delete(roomId);
        classCodes.delete(roomId);
        lockedRooms.delete(roomId);
        console.log(`🗑  Cleaned up room: ${roomId}`);
      } else {
        broadcastParticipants(roomId);
      }

      socket.to(roomId).emit('user-left', { socketId: socket.id });

      io.to(roomId).emit('chat-message', {
        system: true,
        text: `${userId || 'Someone'} left the meeting`,
        ts: Date.now()
      });
    }
    console.log('❌ Disconnected:', socket.id);
  });
});

function broadcastParticipants(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  const list = [...room.entries()].map(([socketId, info]) => ({
    socketId,
    ...info
  }));
  io.to(roomId).emit('participants', list);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () =>
  console.log(`🚀 Server on http://localhost:${PORT}`)
);