import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get current timestamp in YYYYMMDDTHHMMSS format
const timestamp = new Date().toISOString()
    .replace(/[-:]/g, '')
    .replace(/\..+/, '');

// Write timestamp to build_time.txt
const buildTimePath = path.join(__dirname, '../public/build_time.txt');
fs.writeFileSync(buildTimePath, timestamp, 'utf8');

console.log(`Build timestamp written to: ${buildTimePath}`); 