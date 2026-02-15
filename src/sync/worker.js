import { parentPort } from 'worker_threads';
import cacache from 'cacache';
import { mkdir, writeFile } from 'fs/promises';
import { dirname, join } from 'path';

parentPort.on('message', async ({ id, cacheRoot, cacheKey, targets }) => {
    const results = [];

    try {
        const { data } = await cacache.get(cacheRoot, cacheKey);

        for (const target of targets) {
            try {
                switch (target.driver) {
                    case 'file': {
                        const filePath = join(target.root, target.key);
                        await mkdir(dirname(filePath), { recursive: true });
                        await writeFile(filePath, data);
                        results.push({ backend: target.name, key: target.key, success: true });
                        break;
                    }
                    // Future: 's3', 'smb', etc.
                    default:
                        results.push({ backend: target.name, success: false, error: `Unknown driver: ${target.driver}` });
                }
            } catch (err) {
                results.push({ backend: target.name, success: false, error: err.message });
            }
        }
    } catch (err) {
        for (const target of targets) {
            results.push({ backend: target.name, success: false, error: `Cache read failed: ${err.message}` });
        }
    }

    parentPort.postMessage({ id, results });
});
