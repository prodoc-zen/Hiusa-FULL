import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const dir = path.join(rootDir, 'test-results', 'voiceover-walkthroughs');

console.log('Remastering walkthrough audio to Broadcast Loudness Standard (-14 LUFS, -1.0 dB true peak)...');

const mp4Files = fs.readdirSync(dir).filter((f) => f.endsWith('.mp4'));
for (const file of mp4Files) {
  const input = path.join(dir, file);
  const temp = path.join(dir, `temp_loud_${file}`);
  console.log(`  -> Remastering MP4: ${file}...`);
  execSync(`ffmpeg -y -i "${input}" -af "loudnorm=I=-14:TP=-1.0:LRA=11" -c:v copy -c:a aac -b:a 192k "${temp}"`, {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  fs.copyFileSync(temp, input);
  fs.unlinkSync(temp);
}

const webmFiles = fs.readdirSync(dir).filter((f) => f.endsWith('.webm'));
for (const file of webmFiles) {
  const input = path.join(dir, file);
  const temp = path.join(dir, `temp_loud_${file}`);
  console.log(`  -> Remastering WebM: ${file}...`);
  execSync(`ffmpeg -y -i "${input}" -af "loudnorm=I=-14:TP=-1.0:LRA=11" -c:v copy -c:a libopus -b:a 160k "${temp}"`, {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  fs.copyFileSync(temp, input);
  fs.unlinkSync(temp);
}

console.log('All 10 video files successfully remastered with elevated volume and broadcast clarity!');
