// Smoke test del módulo email/ contra el buzón de prueba. Solo lectura.
try { require('dotenv').config(); } catch (_) {}
const { fetchNewEnvelopes } = require('../email/imapClient.cjs');
const { matchKeywords } = require('../email/keywordMatcher.cjs');

const conn = {
  host: process.env.IMAP_TEST_HOST || 'imap.mail.yahoo.com',
  user: process.env.YAHOO_TEST_EMAIL,
  pass: process.env.YAHOO_TEST_APP_PASSWORD,
};
const readline = require('readline').createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((r) => readline.question(q, r));

(async () => {
  try {
    const first = await fetchNewEnvelopes({ ...conn, lastUid: null, uidValidity: null });
    console.log('1ra vez -> mensajes:', first.messages.length, '| lastUid:', first.lastUid, '| uidValidity:', first.uidValidity);

    await ask('\nAhora manda un correo con "factura" en el asunto a ese buzón, espera 1 min y presiona Enter... ');

    const second = await fetchNewEnvelopes({ ...conn, lastUid: first.lastUid, uidValidity: first.uidValidity });
    console.log('2da vez -> mensajes nuevos:', second.messages.length, '| lastUid:', second.lastUid);
    for (const m of second.messages) {
      console.log(' uid', m.uid, '| match:', matchKeywords(m, ['factura']));
    }

    const third = await fetchNewEnvelopes({ ...conn, lastUid: second.lastUid, uidValidity: second.uidValidity });
    console.log('3ra vez (sin correo nuevo) -> mensajes:', third.messages.length, '(debe ser 0)');
  } catch (e) {
    console.error('Error:', e.code || '', e.message);
  } finally {
    readline.close();
  }
})();