import { readDoc, writeDoc } from './kvClient';

export async function getHistoryFromKV(code, type, days = 250) {
    const key = `hist:${type}:${code}`;
    const doc = await readDoc(key, []);
    const history = Array.isArray(doc) ? doc : (doc?.history || []);
    return history.slice(-days);
}

export async function getBulkHistoryFromKV(items, days = 250) {
    const result = {};
    const promises = items.map(async (it) => {
        const key = `hist:${it.type}:${it.code}`;
        const doc = await readDoc(key, null);
        const history = Array.isArray(doc) ? doc : (doc?.history || []);
        if (history && history.length > 0) {
            result[`${it.type}:${it.code}`] = history.slice(-days);
        }
    });

    await Promise.all(promises);
    return result;
}

export async function insertDailyPrice(code, type, price, date) {
    const key = `hist:${type}:${code}`;
    const doc = await readDoc(key, []);
    const history = Array.isArray(doc) ? doc : (doc?.history || []);

    const existingIdx = history.findIndex(p => p.date === date);
    if (existingIdx > -1) {
        history[existingIdx].value = price;
    } else {
        history.push({ date, value: price });
        history.sort((a, b) => a.date.localeCompare(b.date));
    }

    if (history.length > 400) history.shift();
    await writeDoc(key, { date: date, history });
}

export async function insertDailyPricesBatch(records) {
    const groups = {};
    for (const r of records) {
        const key = `${r.type}:${r.code}`;
        if (!groups[key]) groups[key] = [];
        groups[key].push(r);
    }

    const promises = Object.entries(groups).map(async ([key, items]) => {
        const [type, code] = key.split(':');
        const kvKey = `hist:${type}:${code}`;
        const doc = await readDoc(kvKey, []);
        const history = Array.isArray(doc) ? doc : (doc?.history || []);
        let latestDate = history.length > 0 ? history[history.length - 1].date : '';

        items.forEach(it => {
            const idx = history.findIndex(p => p.date === it.date);
            if (idx > -1) history[idx].value = it.price;
            else history.push({ date: it.date, value: it.price });
            if (it.date > latestDate) latestDate = it.date;
        });

        history.sort((a, b) => a.date.localeCompare(b.date));
        if (history.length > 400) history.splice(0, history.length - 400);
        await writeDoc(kvKey, { date: latestDate, history });
    });

    await Promise.all(promises);
}
