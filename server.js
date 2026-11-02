const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT || 3000);
const MODEL = process.env.OPENAI_MODEL || 'gpt-5.4-mini';
const MAX_BODY_BYTES = 12 * 1024 * 1024;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon'
};

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(JSON.stringify(payload));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Request is too large. Please use a smaller screenshot.'));
        req.destroy();
        return;
      }
      body += chunk.toString('utf8');
    });
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); }
      catch { reject(new Error('Invalid JSON request.')); }
    });
    req.on('error', reject);
  });
}

function extractOutputText(response) {
  if (typeof response.output_text === 'string') return response.output_text;
  const chunks = [];
  for (const item of response.output || []) {
    for (const content of item.content || []) {
      if (content.type === 'output_text' && content.text) chunks.push(content.text);
    }
  }
  return chunks.join('\n').trim();
}

async function analyzeWithOpenAI({ imageDataUrl, goal, language, extraContext }) {
  const systemPrompt = `You are SAATHI, a patient digital-navigation coach for adults with limited digital literacy. Your job is to help the user understand the CURRENT interface and complete their stated task one safe step at a time.\n\nRules:\n- Be warm, respectful, and non-judgmental. Use short, plain sentences.\n- Respond in the requested language: ${language || 'English'}. Keep common UI labels in their original language and quote them exactly when visible.\n- Inspect the supplied screenshot carefully. Never invent buttons, labels, fields, prices, dates, train availability, or page state. If text is unreadable or the screenshot is missing, say what you cannot verify.\n- Give the single best next action first. Then give at most 3 short steps. Explain what the user should look for and what will happen next.\n- If the user is booking tickets, filling forms, paying, or changing account settings, guide but do NOT claim you have completed the action. Never ask for an OTP, PIN, password, CVV, full card number, or other secret. Tell the user to enter secrets themselves only on the trusted official interface.\n- For payments or irreversible actions, pause before the final confirmation and explain the amount/recipient should be checked by the user.\n- Mention suspicious or risky elements if visible, but do not declare a site fraudulent from appearance alone.\n- If the user has not stated a goal, explain what this screen is for and ask what they want to do.\n\nReturn ONLY valid JSON with this exact shape:\n{\n  "screen_title": "short title",\n  "screen_summary": "1-2 plain-language sentences describing the visible screen",\n  "next_action": "the single best next action, or a question if the goal is unclear",\n  "steps": [{"title":"short label","instruction":"plain-language instruction","target":"exact visible button or field label, or empty string","why":"brief reason","risk":"low|medium|high"}],\n  "warnings": ["short safety note, if any"],\n  "follow_up": "what the user should tell or show you after this step"\n}\nUse 1-3 steps. Use empty arrays when appropriate. Do not wrap JSON in markdown fences.`;

  const userContent = [
    { type: 'input_text', text: `User's goal: ${goal || 'Please explain this screen and tell me what I can do next.'}\nAdditional context: ${extraContext || 'None'}\nAnalyze the screenshot and guide the user from the CURRENT visible state.` }
  ];
  if (imageDataUrl) {
    userContent.push({ type: 'input_image', image_url: imageDataUrl, detail: 'high' });
  }

  const apiResponse = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: MODEL,
      input: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent }
      ],
      max_output_tokens: 1100
    })
  });

  const data = await apiResponse.json().catch(() => ({}));
  if (!apiResponse.ok) {
    const message = data.error?.message || `AI request failed with status ${apiResponse.status}.`;
    throw new Error(message);
  }

  const text = extractOutputText(data);
  if (!text) throw new Error('The AI returned an empty response. Please try again.');

  try {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
  } catch {
    // Fall through to a readable response if the model did not return valid JSON.
  }
  return {
    screen_title: 'Your screen guide',
    screen_summary: text,
    next_action: 'Read the explanation above, then share the next screen when you are ready.',
    steps: [],
    warnings: [],
    follow_up: 'What do you see after taking that action?'
  };
}

function serveStatic(req, res) {
  const requestPath = decodeURIComponent((req.url || '/').split('?')[0]);
  const safePath = requestPath === '/' ? '/index.html' : requestPath;
  const resolved = path.resolve(PUBLIC_DIR, `.${safePath}`);
  if (!resolved.startsWith(PUBLIC_DIR + path.sep) && resolved !== path.join(PUBLIC_DIR, 'index.html')) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.readFile(resolved, (err, file) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(resolved).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin'
    });
    res.end(file);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/api/status') {
    return sendJson(res, 200, { aiReady: Boolean(process.env.OPENAI_API_KEY), model: MODEL });
  }
  if (req.method === 'POST' && req.url === '/api/analyze') {
    try {
      const body = await readJson(req);
      if (!process.env.OPENAI_API_KEY) {
        return sendJson(res, 503, {
          error: 'AI is not connected yet. Add OPENAI_API_KEY to your environment to enable live screen understanding. The guided practice demo works without it.'
        });
      }
      if (body.imageDataUrl && !/^data:image\/(png|jpeg|webp);base64,/.test(body.imageDataUrl)) {
        return sendJson(res, 400, { error: 'Unsupported screenshot format. Please upload a PNG, JPG or WEBP image.' });
      }
      const result = await analyzeWithOpenAI({
        imageDataUrl: body.imageDataUrl || null,
        goal: String(body.goal || '').slice(0, 1500),
        language: String(body.language || 'English').slice(0, 40),
        extraContext: String(body.extraContext || '').slice(0, 1500)
      });
      return sendJson(res, 200, { result, model: MODEL });
    } catch (error) {
      console.error('Analysis error:', error.message);
      return sendJson(res, 500, { error: error.message || 'Something went wrong while analyzing the screen.' });
    }
  }
  if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res);
  res.writeHead(405); res.end('Method not allowed');
});

server.listen(PORT, () => {
  console.log(`SAATHI is running at http://localhost:${PORT}`);
  console.log(`AI screen understanding: ${process.env.OPENAI_API_KEY ? `enabled (${MODEL})` : 'demo mode (no API key configured)'}`);
});
