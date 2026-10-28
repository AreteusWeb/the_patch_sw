// Prueba local de DeepSeek. No imprime la key.
try { require('dotenv').config(); } catch (_) {}
const OpenAI = require('openai');

const key = process.env.DEEPSEEK_API_KEY;
if (!key) { console.error('Falta DEEPSEEK_API_KEY en el entorno/.env'); process.exit(1); }

const client = new OpenAI({
  apiKey: key,
  baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
});
const model = process.env.DEEPSEEK_MODEL || 'deepseek-chat';

(async () => {
  const t0 = Date.now();
  try {
    const r = await client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: 'Responde solo: ok, en una palabra.' }],
      max_tokens: 50,
    });
    console.log('modelo:', r.model);
    console.log('respuesta:', r.choices[0].message.content);
    console.log('usage:', JSON.stringify(r.usage));
    console.log('latencia ms:', Date.now() - t0);
  } catch (e) {
    console.error('Error:', e.status, e.message);
  }
})();