// POST /api/check  { images?: [{ base64, mediaType }], sample?: boolean, alternatePanel?: boolean }
// Works as a Vercel serverless function and in the local server (server.js).
import { loadRules } from '../lib/rules.js';
import { evaluate } from '../lib/evaluate.js';
import { extractLabel, MissingKeyError, SAMPLE_LABEL } from '../lib/extract.js';

const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_IMAGES = 5;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body ?? {});
  try {
    let label;
    if (body.sample) label = SAMPLE_LABEL;
    else {
      const images = Array.isArray(body.images) ? body.images : [];
      if (!images.length || images.some((i) => !i.base64 || !ALLOWED.includes(i.mediaType))) {
        return res.status(400).json({ error: 'JPG, PNG, WEBP 이미지를 올려 주세요.' });
      }
      if (images.length > MAX_IMAGES) return res.status(400).json({ error: `사진은 ${MAX_IMAGES}장까지 올릴 수 있어요.` });
      label = await extractLabel({ images });
    }
    const rules = loadRules({ region: 'US', category: 'supplement' });
    const result = evaluate(label, rules, { alternatePanel: !!body.alternatePanel });
    return res.status(200).json({ label, ...result, sample: !!body.sample });
  } catch (err) {
    if (err instanceof MissingKeyError) {
      return res.status(503).json({ error: '서버에 ANTHROPIC_API_KEY가 없어서 사진을 읽을 수 없어요. 샘플 라벨로 먼저 해보세요.' });
    }
    console.error(err);
    return res.status(500).json({ error: '라벨을 읽는 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.' });
  }
}
