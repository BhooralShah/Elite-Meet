const fs = require('fs');
const path = require('path');

async function uploadRecording(localPath, roomId) {
  // MOCK: copy to public folder so it's downloadable via URL
  const dest = path.join(__dirname, '..', 'public', 'recordings');
  fs.mkdirSync(dest, { recursive: true });

  const filename = `recording-${roomId}-${Date.now()}.mp4`;
  const destPath = path.join(dest, filename);

  fs.copyFileSync(localPath, destPath);
  console.log('⚠️  MOCK UPLOAD — saved locally:', filename);

  return `/recordings/${filename}`;
}

module.exports = { uploadRecording };