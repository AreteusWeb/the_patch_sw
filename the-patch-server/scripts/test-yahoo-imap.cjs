// Prueba local IMAP Yahoo/Turbify. Solo lectura, no imprime la contraseña.
try { require('dotenv').config(); } catch (_) {}
const { ImapFlow } = require('imapflow');

const host = process.env.IMAP_TEST_HOST || 'imap.mail.yahoo.com';
const user = process.env.YAHOO_TEST_EMAIL;
const pass = process.env.YAHOO_TEST_APP_PASSWORD;
if (!user || !pass) { console.error('Faltan variables en .env'); process.exit(1); }

const KEYWORDS = ['factura', 'urgente']; // cámbialas para probar

(async () => {
  const client = new ImapFlow({
    host, port: 993, secure: true,
    auth: { user, pass }, logger: false,
  });
  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX', { readOnly: true });
    try {
      const total = client.mailbox.exists;
      console.log('mensajes en INBOX:', total);
      if (total === 0) return;
      const start = Math.max(1, total - 4);
      for await (const msg of client.fetch(`${start}:*`, { envelope: true })) {
        const subject = msg.envelope.subject || '';
        const hit = KEYWORDS.some(k => subject.toLowerCase().includes(k));
        console.log(msg.envelope.date, '|', subject.slice(0, 60), '| match:', hit);
      }
    } finally { lock.release(); }
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    try { await client.logout(); } catch (_) {}
  }
})();