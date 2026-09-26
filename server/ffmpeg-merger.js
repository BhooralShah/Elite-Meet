const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');

function mergeRoomRecordings(roomId) {
  return new Promise((resolve, reject) => {
    const roomDir = path.join(UPLOAD_DIR, roomId);
    if (!fs.existsSync(roomDir)) return reject(new Error('No recordings found'));

    const outputDir = path.join(UPLOAD_DIR, `${roomId}-output`);
    fs.mkdirSync(outputDir, { recursive: true });

    const users = fs.readdirSync(roomDir);

    let teacherVideoFile = null;
    const studentAudioFiles = [];

    for (const user of users) {
      const userDir = path.join(roomDir, user);
      if (!fs.statSync(userDir).isDirectory()) continue;

      const videoFile = path.join(userDir, 'video', 'recording.webm');
      const audioFile = path.join(userDir, 'audio', 'recording.webm');

      if (fs.existsSync(videoFile)) {
        teacherVideoFile = videoFile;
        const sizeMB = (fs.statSync(videoFile).size / 1024 / 1024).toFixed(2);
        console.log(`  🎥 Teacher video: ${sizeMB} MB`);
      }

      if (fs.existsSync(audioFile)) {
        studentAudioFiles.push({ user, file: audioFile });
        const sizeKB = (fs.statSync(audioFile).size / 1024).toFixed(1);
        console.log(`  🎙  Student audio (${user}): ${sizeKB} KB`);
      }
    }

    if (!teacherVideoFile) {
      return reject(new Error('No teacher video found'));
    }

    // ---- Step 1: Convert teacher WebM to MP4 ----
    const videoMp4 = path.join(outputDir, 'video.mp4');

    runFFmpeg(
      `ffmpeg -y -i "${teacherVideoFile}" ` +
      `-c:v libx264 -preset ultrafast -crf 28 ` +
      `-c:a aac -b:a 128k -movflags +faststart ` +
      `"${videoMp4}"`
    )
      .then(() => {
        // ---- Step 2: Convert each student audio to M4A ----
        const audioTasks = studentAudioFiles.map(({ user, file }) => {
          const out = path.join(outputDir, `audio-${user}.m4a`);
          return runFFmpeg(
            `ffmpeg -y -i "${file}" -ac 1 -ar 44100 -c:a aac "${out}"`
          ).then(() => ({ user, file: out }));
        });

        return Promise.all(audioTasks);
      })
      .then((studentAudios) => {
        // ---- Step 3: Mix all audios into video ----
        const finalOutput = path.join(outputDir, 'recording.mp4');

        if (studentAudios.length === 0) {
          fs.copyFileSync(videoMp4, finalOutput);
          console.log('  ℹ️  No student audio — copying video only');
          return finalOutput;
        }

        const inputs = studentAudios.map(({ file }) => `-i "${file}"`).join(' ');
        const filterInputs = studentAudios.map((_, i) => `[${i + 1}:a]`).join('');
        const filter =
          `${filterInputs}amix=inputs=${studentAudios.length}:duration=longest:dropout_transition=3[aout]`;

        const mixCmd =
          `ffmpeg -y -i "${videoMp4}" ${inputs} ` +
          `-filter_complex "${filter}" ` +
          `-map 0:v -map "[aout]" ` +
          `-c:v copy -c:a aac -b:a 128k -shortest ` +
          `"${finalOutput}"`;

        console.log(`  🎛  Mixing ${studentAudios.length} student audio track(s)`);
        return runFFmpeg(mixCmd).then(() => finalOutput);
      })
      .then((finalFile) => {
        const sizeMB = (fs.statSync(finalFile).size / 1024 / 1024).toFixed(2);
        console.log(`✅ Final merged: ${finalFile} (${sizeMB} MB)`);
        resolve(finalFile);
      })
      .catch(reject);
  });
}

function runFFmpeg(cmd) {
  return new Promise((resolve, reject) => {
    console.log('▶️ ', cmd.substring(0, 120) + '...');
    const proc = exec(cmd, { maxBuffer: 1024 * 1024 * 100 }, (error, stdout, stderr) => {
      if (error) {
        console.error('FFmpeg error:', stderr.slice(0, 500));
        return reject(error);
      }
      resolve();
    });

    const timeout = setTimeout(() => {
      proc.kill();
      reject(new Error('FFmpeg timeout (5 min)'));
    }, 5 * 60 * 1000);
    proc.on('exit', () => clearTimeout(timeout));
  });
}

module.exports = { mergeRoomRecordings };