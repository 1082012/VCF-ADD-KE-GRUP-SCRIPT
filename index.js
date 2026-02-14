import { 
    makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    Browsers
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import fs from 'fs';
import { config } from './config.js';
import { sleep, humanDelay } from './lib/delay.js';
import { getState, saveState, resetState } from './lib/state.js';
import { parseVCF, generateVCF } from './lib/vcf.js';
import { getGroupMetadata } from './lib/group.js';
import { antiBanMonitor } from './lib/antiban.js';

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState(config.sessionFolder);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })),
        },
        browser: Browsers.ubuntu('Chrome')
    });

    if (!sock.authState.creds.registered) {
        const phoneNumber = config.pairingNumber.replace(/[^0-9]/g, '');
        setTimeout(async () => {
            let code = await sock.requestPairingCode(phoneNumber);
            code = code?.match(/.{1,4}/g)?.join("-") || code;
            console.log(`\n\x1b[32m[ PAIRING CODE ]\x1b[0m : ${code}\n`);
        }, 3000);
    }

    sock.ev.on('creds.update', saveCreds);

    const sendToOwner = async (text) => {
        for (let num of config.ownerNumber) {
            await sock.sendMessage(num + '@s.whatsapp.net', { text }).catch(() => {});
        }
    };

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
            if (reason !== DisconnectReason.loggedOut) startBot();
        } else if (connection === 'open') {
            console.log('VCF Bot Connected!');
            await sendToOwner(`[ SYSTEM ] Bot is Online & Ready`);
        }
    });

    sock.ev.on('groups.upsert', async (groups) => {
        for (const group of groups) {
            const meta = await getGroupMetadata(sock, group.id);
            if (meta) {
                await sendToOwner(`[ GROUP DETECTED ]\nNama : ${meta.name}\nJID  : ${meta.jid}\nMember : ${meta.members}`);
            }
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        try {
            const m = messages[0];
            if (!m.message || m.key.fromMe) return;

            const from = m.key.remoteJid;
            const sender = m.key.participant || from;
            const isOwner = config.ownerNumber.some(num => sender.includes(num));
            const body = m.message.conversation || m.message.extendedTextMessage?.text || "";

            if (!isOwner) return;

            // Fitur 2: Ambil Member & Kirim VCF ke Owner
if (body === '.ambilmember' && from.endsWith('@g.us')) {
    // 1. Ambil metadata grup (nama & daftar peserta)
    const meta = await getGroupMetadata(sock, from);
    const jids = meta.participants.map(p => p.id);
    
    // 2. Generate konten file VCF
    const vcf = generateVCF(jids, meta.name);
    
    // 3. Simpan sementara di folder data
    const path = `./data/members_${Date.now()}.vcf`;
    fs.writeFileSync(path, vcf);
    
    // 4. Kirim file ke Owner (Private Chat)
    await sock.sendMessage(sender, { 
        document: fs.readFileSync(path), 
        fileName: `Members_${meta.name}.vcf`, 
        mimetype: 'text/vcard' 
    });
    
    // 5. Hapus file sampah setelah terkirim
    fs.unlinkSync(path);
}

            // Fitur 3: Add VCF to Group
            if (body.startsWith('.addvcfto')) {
                const targetJid = body.split(' ')[1];
                const quoted = m.message.extendedTextMessage?.contextInfo?.quotedMessage;
                
                if (!targetJid || !quoted?.documentMessage) {
                    return sock.sendMessage(from, { text: "Reply file VCF dan ketik: .addvcfto jidgrup" });
                }

                const buffer = await sock.downloadMediaMessage(m.message.extendedTextMessage.contextInfo.quotedMessage.documentMessage);
                const contacts = parseVCF(buffer.toString());

                await sock.sendMessage(from, { text: "Pilih kecepatan add:\n1d, 3d, 5d, 10d" });

                const collector = async (v) => {
                    const reply = v.messages[0];
                    if (reply.key.remoteJid === from && config.ownerNumber.some(n => (reply.key.participant || reply.key.remoteJid).includes(n))) {
                        const input = reply.message.conversation || reply.message.extendedTextMessage?.text;
                        if (/^\d+d$/.test(input)) {
                            sock.ev.off('messages.upsert', collector);
                            executeProcess(sock, contacts, targetJid, parseInt(input), sendToOwner);
                        }
                    }
                };
                sock.ev.on('messages.upsert', collector);
            }

            // Fitur 4: Pause & Stop
            if (body === '.pausevcf') {
                const s = getState();
                s.status = 'paused';
                saveState(s);
                await sock.sendMessage(from, { text: "⏸️ Proses dipause." });
            }

            if (body === '.stopvcf') {
                const s = getState();
                s.status = 'stopped';
                saveState(s);
                await sock.sendMessage(from, { text: "🛑 Proses dihentikan total." });
            }

        } catch (err) {
            console.error(err);
            await sendToOwner(`[ ERROR ] ${err.message}`);
        }
    });
}

async function executeProcess(sock, contacts, targetJid, delaySec, reportFn) {
    let state = { status: 'running', lastIndex: 0, total: contacts.length, targetJid, success: 0, failed: 0 };
    saveState(state);

    for (let i = 0; i < contacts.length; i++) {
        let current = getState();
        if (current.status === 'stopped') break;
        while (current.status === 'paused') {
            await sleep(2000);
            current = getState();
            if (current.status === 'stopped') break;
        }

        try {
            await antiBanMonitor(i, config.maxInvitePerMinute);
            
            const res = await sock.groupParticipantsUpdate(targetJid, [contacts[i]], "add");
            if (res[0].status === "200") state.success++;
            else state.failed++;
        } catch (e) {
            state.failed++;
        }

        state.lastIndex = i;
        saveState(state);

        if (i % 5 === 0 || i === contacts.length - 1) {
            await reportFn(`[ ADDING VCF ]\nGroup : ${targetJid}\nProgress : ${i + 1} / ${contacts.length}\nSuccess : ${state.success}\nFailed : ${state.failed}\nStatus : ${state.status.toUpperCase()}`);
        }

        await humanDelay(delaySec);
    }

    await reportFn(`[ COMPLETED ]\nProses selesai.\nTotal Success: ${state.success}\nTotal Failed: ${state.failed}`);
    resetState();
}

startBot();
