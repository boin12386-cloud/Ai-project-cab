import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 3000);
const publicDir = path.join(__dirname, 'public');

app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '32kb' }));
app.use('/api/ai', rateLimit({ windowMs: 60_000, limit: Number(process.env.AI_RATE_LIMIT_PER_MINUTE || 10), standardHeaders: 'draft-7', legacyHeaders: false }));

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'BOIN', time: new Date().toISOString() }));
app.get('/api/config', (_req, res) => res.json({
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
  aiConfigured: Boolean(process.env.OPENAI_API_KEY)
}));

const ALLOWED_TOOLS = new Set(['caption','bio','username','hashtags','prompt','reel','ideas','rewrite','polish','thumbnail','carousel','hooks','brief','business']);
function safeString(v, max=5000) {
  if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') return '';
  return String(v).trim().slice(0, max);
}
function buildInstruction(tool, inputs) {
  const input = Object.entries(inputs).map(([k,v]) => `${safeString(k,80)}: ${safeString(v,1500)}`).join('\n');
  const task = {
    caption:'Create a social caption with a strong hook, main caption, and natural call to action. Respect the selected platform, tone, length, and emoji preference.',
    bio:'Create 5 distinct profile bios matching the requested niche, interests, personal brand, tone, and emoji preference.',
    username:'Suggest 20 creative username ideas based on the provided keywords and style. Do not claim availability.',
    hashtags:'Suggest relevant hashtags grouped by broad, niche, and community tags. Do not promise reach or virality.',
    prompt:'Build a coherent detailed prompt for the requested visual output, including subject, style, lighting, camera angle, composition, palette, aspect ratio, and quality details.',
    reel:'Write a short-form video script with hook, scene-by-scene visuals, voice-over, on-screen text, ending, and CTA.',
    ideas:'Generate distinct, practical content ideas tailored to the requested platform, niche, and audience.',
    rewrite:'Rewrite the supplied text in the requested style while preserving meaning. Return only the rewritten version.',
    polish:'Review the text for clarity, grammar, spelling, and structure. Separate definite language corrections from optional style suggestions. Do not claim certainty when ambiguous.',
    thumbnail:'Create a practical thumbnail design brief with composition, focal subject, text hierarchy, colour direction, and export recommendations.',
    carousel:'Create a slide-by-slide carousel outline with a strong first slide, useful progression, and a clear ending.',
    hooks:'Generate 15 distinct short-video opening hooks tailored to the topic and tone.',
    brief:'Turn the idea into a creative brief with objective, audience, key message, visual direction, deliverables, and constraints.',
    business:'Suggest distinctive business or brand names and explain the positioning of the strongest options. Do not claim trademark or domain availability.'
  }[tool];
  return `You are BOIN's helpful creative assistant. Be clear, original, practical, and culturally respectful. If Malayalam is requested, use natural Malayalam. Never claim external checks were performed unless they were.\\n\\nTask: ${task}\\n\\nUser selections:\\n${input}`;
}
app.post('/api/ai', async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) return res.status(503).json({ error: 'Real AI is not configured yet. Add OPENAI_API_KEY to the server environment. Local demo tools remain available.' });
    const tool = safeString(req.body?.tool, 40);
    const rawInputs = req.body?.inputs;
    if (!ALLOWED_TOOLS.has(tool)) return res.status(400).json({ error: 'Unsupported AI tool.' });
    if (!rawInputs || typeof rawInputs !== 'object' || Array.isArray(rawInputs)) return res.status(400).json({ error: 'Please submit valid tool inputs.' });
    const inputs = Object.fromEntries(Object.entries(rawInputs).slice(0, 30).map(([k,v]) => [safeString(k,80), safeString(v,1500)]));
    if (JSON.stringify(inputs).length > 12000) return res.status(413).json({ error: 'Your input is too long. Please shorten it and try again.' });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45_000);
    let response;
    try {
      response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: process.env.OPENAI_MODEL || 'gpt-6-astra',
          instructions: buildInstruction(tool, inputs),
          input: 'Create the requested result now. Use useful headings and concise formatting where appropriate.'
        })
      });
    } finally { clearTimeout(timeout); }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error('OpenAI API error:', response.status, data?.error?.code || data?.error?.type || 'unknown');
      return res.status(response.status === 429 ? 429 : 502).json({ error: response.status === 429 ? 'AI usage is temporarily limited. Please try again shortly.' : 'The AI provider could not complete this request. Check the server logs and API account configuration.' });
    }
    const output = String(data.output_text || '').trim();
    if (!output) return res.status(502).json({ error: 'The AI provider returned no text. Please try again.' });
    res.json({ output, mode: 'real-ai' });
  } catch (err) {
    if (err.name === 'AbortError') return res.status(504).json({ error: 'The AI request took too long. Please try again.' });
    console.error('AI route error:', err.message);
    res.status(500).json({ error: 'Unexpected server error while generating content.' });
  }
});

app.use(express.static(publicDir, { extensions: ['html'] }));
app.get('*', (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));
app.listen(PORT, () => console.log(`BOIN is running on http://localhost:${PORT}`));
