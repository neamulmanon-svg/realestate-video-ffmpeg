const express = require('express');
const ffmpeg = require('fluent-ffmpeg');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const app = express();
app.use(cors());
app.use(express.json());
app.use('/videos', express.static('uploads'));
app.get('/', (req, res) => {
  res.json({ status: 'FFmpeg Video Merger Running', version: '1.0.0' });
});
async function downloadVideo(url, filepath) {
  const response = await axios({ method: 'GET', url: url, responseType: 'stream' });
  const writer = fs.createWriteStream(filepath);
  response.data.pipe(writer);
  return new Promise((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
}
app.post('/merge', async (req, res) => {
  const { clips, style, output_name } = req.body;
  if (!clips || !Array.isArray(clips) || clips.length === 0) {
    return res.status(400).json({ error: 'No clips provided' });
  }
  const jobId = uuidv4();
  const tempDir = path.join(__dirname, 'temp', jobId);
  const uploadsDir = path.join(__dirname, 'uploads');
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
  try {
    const localClips = [];
    for (let i = 0; i < clips.length; i++) {
      const clipPath = path.join(tempDir, `clip_${i}.mp4`);
      await downloadVideo(clips[i], clipPath);
      localClips.push(clipPath);
    }
    const listPath = path.join(tempDir, 'filelist.txt');
    fs.writeFileSync(listPath, localClips.map(f => `file '${f}'`).join('\n'));
    const outputFilename = `${output_name || jobId}.mp4`;
    const outputPath = path.join(uploadsDir, outputFilename);
    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(listPath)
        .inputOptions(['-f', 'concat', '-safe', '0'])
        .outputOptions(['-c:v', 'libx264', '-preset', 'fast', '-crf', '23', '-movflags', '+faststart'])
        .output(outputPath)
        .on('end', resolve)
        .on('error', reject)
        .run();
    });
    fs.rmSync(tempDir, { recursive: true, force: true });
    const baseUrl = process.env.RAILWAY_PUBLIC_DOMAIN
      ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
      : `http://localhost:${process.env.PORT || 3000}`;
    res.json({
      success: true,
      video_url: `${baseUrl}/videos/${outputFilename}`,
      clips_merged: clips.length
    });
  } catch (error) {
    if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
    res.status(500).json({ error: 'Merge failed', message: error.message });
  }
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`FFmpeg service on port ${PORT}`));
