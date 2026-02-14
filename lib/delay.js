export const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export const humanDelay = async (seconds) => {
    const extra = Math.floor(Math.random() * 1500) + 500; 
    await sleep((seconds * 1000) + extra);
};
