const fs = require('fs');
const path = require('path');

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');

function handleRecordingChunk(socket) {
  socket.on('recording-chunk', ({ roomId, userId, chunk, timestamp }) => {
    try {
      const userDir = path.join(UPLOAD_DIR, roomId, userId, 'video');
      fs.mkdirSync(userDir, { recursive: true });

      const filename = path.join(userDir, `recording.webm`);
      fs.writeFileSync(filename, Buffer.from(chunk));

      const sizeMB = (chunk.byteLength / 1024 / 1024).toFixed(2);
      console.log(`  💾 Saved teacher video: ${filename} (${sizeMB} MB)`);
    } catch (err) {
      console.error('Video chunk write error:', err);
    }
  });
}

function handleAudioChunk(socket) {
  socket.on('audio-chunk', ({ roomId, userId, chunk, timestamp }) => {
    try {
      const userDir = path.join(UPLOAD_DIR, roomId, userId, 'audio');
      fs.mkdirSync(userDir, { recursive: true });

      const filename = path.join(userDir, `recording.webm`);
      fs.writeFileSync(filename, Buffer.from(chunk));

      const sizeKB = (chunk.byteLength / 1024).toFixed(1);
      console.log(`  💾 Saved student audio: ${filename} (${sizeKB} KB)`);
    } catch (err) {
      console.error('Audio chunk write error:', err);
    }
  });
}

module.exports = { handleRecordingChunk, handleAudioChunk };