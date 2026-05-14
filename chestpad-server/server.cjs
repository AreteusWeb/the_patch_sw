/**
 * ChestPad WebSocket Server — producción
 * Recibe datos reales del ESP32 según Data_format.docx
 *
 * Instalar: npm install ws
 * Correr:   node server.cjs
 */

const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8080;
const wss = new WebSocketServer({ port: PORT });

const sessions = new Map();

console.log(`\nChestPad WS Server corriendo en puerto ${PORT}\n`);

wss.on('connection', (ws, req) => {
  ws.deviceId      = null;
  ws.authenticated = false;
  ws.binaryType    = 'arraybuffer';

  console.log(`[+] Conexión nueva desde ${req.socket.remoteAddress}`);

  const authTimeout = setTimeout(() => {
    if (!ws.authenticated) {
      console.log('[TIMEOUT] Sin auth, cerrando conexión');
      ws.close();
    }
  }, 15_000);

  ws.on('message', (data, isBinary) => {

    // Paquete BINARIO — audio auscultación (1600 bytes / 800 muestras int16)
    if (isBinary) {
      if (!ws.authenticated) return;
      const samples = data.byteLength / 2;
      console.log(`[BIN] device=${ws.deviceId} | audio samples=${samples} | bytes=${data.byteLength}`);
      return;
    }

    // Paquete JSON
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      console.warn('[WARN] Mensaje no-JSON ignorado');
      return;
    }

    // Auth handshake
    if (msg.type === 'auth' && msg.mac) {
      clearTimeout(authTimeout);
      const deviceId   = msg.mac.replace(/:/g, '');
      ws.deviceId      = deviceId;
      ws.authenticated = true;
      sessions.set(deviceId, { ws, lastSeen: Date.now(), packetCount: 0 });
      console.log(`[AUTH OK] deviceId=${deviceId} | mac=${msg.mac}`);
      ws.send(JSON.stringify({ type: 'auth_ok', deviceId }));
      return;
    }

    // Telemetría multicanal 8x25
    if (msg.channels && ws.authenticated) {
      const { timestamp, channels } = msg;
      if (!Array.isArray(channels) || channels.length !== 8) {
        console.warn(`[WARN] channels inválido device=${ws.deviceId}`);
        return;
      }
      const sess = sessions.get(ws.deviceId);
      sess.packetCount++;
      sess.lastSeen = Date.now();

      if (sess.packetCount % 10 === 0) {
        const ecg0 = channels[0]?.[0] ?? 'N/A';
        const temp = channels[6]?.[0] ?? 'N/A';
        console.log(`[DATA] device=${ws.deviceId} | ts=${timestamp} | ecg[0]=${ecg0} | temp[0]=${temp} | conectados=${sessions.size}`);
      }
    }
  });

  ws.on('close', () => {
    if (ws.deviceId) {
      sessions.delete(ws.deviceId);
      console.log(`[-] Desconectado: device=${ws.deviceId} | activos=${sessions.size}`);
    }
  });

  ws.on('error', (err) => {
    console.error(`[ERR] device=${ws.deviceId ?? 'sin-auth'} | ${err.message}`);
  });
});

setInterval(() => {
  if (sessions.size === 0) return;
  console.log(`[STATUS] Dispositivos activos: ${sessions.size}`);
  for (const [id, s] of sessions) {
    const secsAgo = Math.round((Date.now() - s.lastSeen) / 1000);
    console.log(`  · ${id} — último dato hace ${secsAgo}s | paquetes=${s.packetCount}`);
  }
}, 30_000);
