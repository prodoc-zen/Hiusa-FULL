import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const destination = resolve(projectRoot, 'public/vendor/digitalpersona');

await mkdir(destination, { recursive: true });
await Promise.all([
  copyFile(resolve(projectRoot, 'node_modules/@digitalpersona/websdk/dist/websdk.client.ui.min.js'), resolve(destination, 'websdk.client.ui.min.js')),
  copyFile(resolve(projectRoot, 'node_modules/@digitalpersona/fingerprint/dist/fingerprint.sdk.min.js'), resolve(destination, 'fingerprint.sdk.min.js')),
]);

console.log('DigitalPersona browser SDK assets copied.');
