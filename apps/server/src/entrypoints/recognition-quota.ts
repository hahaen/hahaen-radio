import { readRecognitionConfig } from '../config/recognition.js';
import { openRecognitionQuota } from '../modules/recognition/quota.js';
try {
  if (process.argv.slice(2).join(' ') !== 'init') throw new Error('Expected init');
  const config = readRecognitionConfig();
  if (!config.enabled) throw new Error('Disabled');
  const quota = await openRecognitionQuota(config, true);
  await quota.close();
  console.log(JSON.stringify({ event: 'recognition_quota_initialized', requests: config.limit }));
} catch {
  console.error(
    'Recognition quota initialization failed: verify private configuration, directory permissions and absence of an existing state or lock',
  );
  process.exitCode = 1;
}
