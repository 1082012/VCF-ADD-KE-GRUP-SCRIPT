export const getGroupMetadata = async (sock, jid) => {
    try {
        const metadata = await sock.groupMetadata(jid);
        return {
            name: metadata.subject,
            jid: metadata.id,
            members: metadata.participants.length,
            participants: metadata.participants
        };
    } catch (e) {
        return null;
    }
};
