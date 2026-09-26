async function sendRecordingEmail(studentEmails, downloadUrl, className) {
  console.log('⚠️  MOCK EMAIL');
  console.log('   To:', studentEmails);
  console.log('   Link:', downloadUrl);
  console.log('   Class:', className);
  return { mock: true };
}

module.exports = { sendRecordingEmail };