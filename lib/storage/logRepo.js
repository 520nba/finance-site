import { readDoc, writeDoc } from './kvClient';

export async function addSystemLog(level, module, message) {
    const key = 'logs:system';
    console.log(`[LOG][${level}][${module}] ${message}`);

    try {
        const logs = await readDoc(key, []);
        logs.unshift({
            level,
            module,
            message,
            timestamp: new Date().toISOString()
        });
        if (logs.length > 200) logs.pop();
        await writeDoc(key, logs);
    } catch (e) { }
}

export async function getSystemLogs(hours = 48) {
    const logs = await readDoc('logs:system', []);
    const cutoff = new Date(Date.now() - hours * 3600 * 1000).toISOString();
    return logs.filter(l => l.timestamp > cutoff);
}
