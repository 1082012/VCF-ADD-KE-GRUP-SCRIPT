import { sleep } from './delay.js';

export const antiBanMonitor = async (count, maxPerMin) => {
    if (count > 0 && count % maxPerMin === 0) {
        console.log(`[ANTIBAN] Limit reached. Cooling down 60s...`);
        await sleep(60000);
        return true;
    }
    return false;
};
