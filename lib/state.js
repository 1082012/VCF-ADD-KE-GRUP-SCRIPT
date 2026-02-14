import fs from 'fs';

const path = './data/runtime.json';

export const getState = () => {
    if (!fs.existsSync(path)) {
        const initial = { status: 'stopped', lastIndex: 0, total: 0, targetJid: null, success: 0, failed: 0 };
        saveState(initial);
        return initial;
    }
    return JSON.parse(fs.readFileSync(path));
};

export const saveState = (data) => {
    if (!fs.existsSync('./data')) fs.mkdirSync('./data');
    fs.writeFileSync(path, JSON.stringify(data, null, 2));
};

export const resetState = () => {
    saveState({ status: 'stopped', lastIndex: 0, total: 0, targetJid: null, success: 0, failed: 0 });
};
