export const parseVCF = (content) => {
    const regex = /TEL;[^:]*:(.*?)\r?\n/g;
    const numbers = [];
    let match;
    while ((match = regex.exec(content)) !== null) {
        let num = match[1].replace(/[^0-9]/g, '');
        if (num.startsWith('0')) num = '62' + num.slice(1);
        if (num.length > 9) {
            const jid = num + '@s.whatsapp.net';
            if (!numbers.includes(jid)) numbers.push(jid);
        }
    }
    return numbers;
};

export const generateVCF = (contacts, groupName) => {
    let vcf = '';
    contacts.forEach((num, i) => {
        const cleanNum = num.split('@')[0];
        vcf += `BEGIN:VCARD\nVERSION:3.0\nFN:Member ${groupName} ${i + 1}\nTEL;TYPE=CELL:${cleanNum}\nEND:VCARD\n`;
    });
    return vcf;
};
