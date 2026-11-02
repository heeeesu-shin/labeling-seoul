// Reads a label image with Claude and returns structured fields.
// It only transcribes what is printed; judging happens in lib/evaluate.js.

const LABEL_SCHEMA = {
  type: 'object',
  properties: {
    visible: {
      type: 'object',
      description: 'Which parts of the package the images show, so missing items can be told apart from items that are simply out of frame.',
      properties: {
        front_panel: { type: 'boolean', description: 'The principal display panel (brand, product name) is readable, not just a lifestyle photo.' },
        supplement_facts: { type: 'boolean', description: 'The Supplement Facts box is readable.' },
        information_panel_complete: { type: 'boolean', description: 'The area around the Supplement Facts box (ingredients, company, contact details) is fully shown, not cropped to the box only.' },
      },
      required: ['front_panel', 'supplement_facts', 'information_panel_complete'],
    },
    statement_of_identity: { type: ['string', 'null'], description: 'Product name as printed on the front panel, verbatim.' },
    front_panel_text: { type: ['string', 'null'], description: 'All text printed on the front panel, verbatim, top to bottom (e.g. brand, product name, "Dietary Supplement", benefit words, net quantity).' },
    net_quantity: {
      type: 'object',
      properties: {
        text: { type: ['string', 'null'], description: 'Net quantity statement verbatim, e.g. "Net Wt 280 g (9.9 oz)".' },
        in_bottom_30_percent: { type: ['boolean', 'null'], description: 'true if it sits in the bottom 30% of the front panel; null if unclear or the front is not visible.' },
      },
      required: ['text', 'in_bottom_30_percent'],
    },
    supplement_facts: {
      type: 'object',
      properties: {
        present: { type: 'boolean' },
        title_text: { type: ['string', 'null'] },
        serving_size: { type: ['string', 'null'] },
        servings_per_container: { type: ['string', 'null'] },
        rows: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              amount: { type: ['string', 'null'] },
              dv_percent: { type: ['string', 'null'], description: 'The %DV value, or null if none is printed.' },
              marked_dv_not_established: { type: 'boolean', description: 'true if marked with † / "Daily Value not established".' },
              dv_symbol: { type: ['string', 'null'], description: 'Footnote symbol printed in the %DV column for this row, e.g. "†" or "**"; null if a percentage or nothing.' },
            },
            required: ['name', 'amount', 'dv_percent', 'marked_dv_not_established', 'dv_symbol'],
          },
        },
        footnote_text: { type: ['string', 'null'], description: 'All footnote text under the panel verbatim, including symbols such as * and †.' },
      },
      required: ['present', 'title_text', 'serving_size', 'servings_per_container', 'rows', 'footnote_text'],
    },
    other_ingredients_text: { type: ['string', 'null'], description: 'The "Other ingredients" list verbatim.' },
    ingredients_text: { type: ['string', 'null'], description: 'Any other ingredient list on the label, verbatim.' },
    contains_statement: { type: ['string', 'null'], description: 'The allergen "Contains:" statement verbatim.' },
    business: {
      type: 'object',
      properties: {
        text: { type: ['string', 'null'], description: 'Manufacturer / distributor line with address, verbatim.' },
        qualifier: { type: ['string', 'null'], description: 'e.g. "Distributed by", "Manufactured for".' },
      },
      required: ['text', 'qualifier'],
    },
    us_contact: {
      type: 'object',
      properties: { phone: { type: ['string', 'null'] }, address: { type: ['string', 'null'] } },
      required: ['phone', 'address'],
    },
    claims: { type: 'array', items: { type: 'string' }, description: 'Every health, function or benefit statement, verbatim.' },
    disclaimer_text: { type: ['string', 'null'], description: 'Any FDA disclaimer text verbatim.' },
    non_english_text_present: { type: 'boolean' },
    non_english_sample: { type: ['string', 'null'] },
    country_of_origin_text: { type: ['string', 'null'] },
    barcode_between_required_info: { type: ['boolean', 'null'] },
  },
  required: ['visible', 'statement_of_identity', 'net_quantity', 'supplement_facts', 'other_ingredients_text', 'ingredients_text',
    'contains_statement', 'business', 'us_contact', 'claims', 'disclaimer_text', 'non_english_text_present',
    'non_english_sample', 'country_of_origin_text', 'barcode_between_required_info'],
};

const PROMPT = `You are transcribing a product label for a US labeling compliance check.
This image may show only one side of the package, or a marketing photo of it. Record only what this image shows.
If the image contains a Supplement Facts box, transcribe every row of it.
Record exactly what is printed. Do not fix, translate or infer missing text.
If something is not on the label, use null (or an empty list). Do not judge compliance.
Always respond by calling the record_label tool exactly once.`;

export class MissingKeyError extends Error {}

// Each photo is read on its own, then merged. Reading several photos in one
// request made the model drop whole sections (e.g. the Supplement Facts box).
export async function extractLabel({ images }) {
  if (!process.env.ANTHROPIC_API_KEY) throw new MissingKeyError('ANTHROPIC_API_KEY is not set');
  const parts = await Promise.all(images.map((img) => extractOne(img)));
  const merged = mergeLabels(parts);
  if (process.env.DEBUG_EXTRACT) console.log(JSON.stringify({ parts, merged }, null, 2));
  return merged;
}

const isEmpty = (v) => v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length);

export function mergeLabels(parts) {
  const out = {};
  for (const p of parts) {
    for (const [k, v] of Object.entries(p ?? {})) {
      if (k === 'supplement_facts') continue;
      if (Array.isArray(v)) out[k] = [...new Set([...(out[k] ?? []), ...v])];
      else if (typeof v === 'boolean') out[k] = out[k] === true || v;
      else if (v && typeof v === 'object') {
        out[k] = out[k] ?? {};
        for (const [kk, vv] of Object.entries(v)) {
          if (typeof vv === 'boolean') out[k][kk] = out[k][kk] === true || vv;
          else if (isEmpty(out[k][kk])) out[k][kk] = vv;
        }
      } else if (isEmpty(out[k])) out[k] = v;
    }
  }
  // Supplement Facts: take the most complete reading rather than mixing rows.
  const sfs = parts.map((p) => p?.supplement_facts).filter((sf) => sf?.present);
  sfs.sort((a, b) => (b.rows?.length ?? 0) - (a.rows?.length ?? 0));
  out.supplement_facts = sfs[0] ?? { present: false, title_text: null, serving_size: null, servings_per_container: null, rows: [], footnote_text: null };
  if (out.visible && sfs.length) out.visible.supplement_facts = true;
  return out;
}

async function extractOne(img) {
  const key = process.env.ANTHROPIC_API_KEY;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
      max_tokens: 6000,
      tools: [{ name: 'record_label', description: 'Record the fields printed on the label.', input_schema: LABEL_SCHEMA }],
      // Newer models reject a forced tool_choice, so we ask in the prompt instead
      // and fall back to parsing JSON from the text reply.
      tool_choice: { type: 'auto' },
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.base64 } },
          { type: 'text', text: PROMPT },
        ],
      }],
    }),
  });
  if (!res.ok) throw new Error(`Claude API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const tool = data.content?.find((c) => c.type === 'tool_use' && c.name === 'record_label');
  if (tool) return tool.input;
  const text = (data.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  const json = text.match(/\{[\s\S]*\}/);
  if (json) {
    try { return JSON.parse(json[0]); } catch { /* fall through */ }
  }
  throw new Error(`Claude did not return label fields: ${text.slice(0, 200)}`);
}

// A realistic first-draft US label for Ownist's collagen jelly stick, with the
// gaps Korean brands commonly ship with. Used for the "try a sample" button.
export const SAMPLE_LABEL = {
  visible: { front_panel: true, supplement_facts: true, information_panel_complete: true },
  statement_of_identity: 'Ownist Collagen Jelly Stick — Dietary Supplement',
  front_panel_text: 'Ownist Collagen Jelly Stick — Dietary Supplement. Supports skin elasticity and hydration. 14 Sticks · 280 g',
  net_quantity: { text: '14 Sticks · 280 g', in_bottom_30_percent: true },
  supplement_facts: {
    present: true,
    title_text: 'Supplement Facts',
    serving_size: 'Serving Size 1 Stick (20 g)',
    servings_per_container: 'Servings Per Container 14',
    rows: [
      { name: 'Calories', amount: '15', dv_percent: null, marked_dv_not_established: false, dv_symbol: null },
      { name: 'Total Carbohydrate', amount: '3 g', dv_percent: '1%', marked_dv_not_established: false, dv_symbol: null },
      { name: 'Vitamin C', amount: '50 mg', dv_percent: '56%', marked_dv_not_established: false, dv_symbol: null },
      { name: 'Fish Collagen Peptide', amount: '1,000 mg', dv_percent: null, marked_dv_not_established: true, dv_symbol: '†' },
      { name: 'Hyaluronic Acid', amount: '20 mg', dv_percent: null, marked_dv_not_established: false, dv_symbol: null },
    ],
    footnote_text: '† Daily Value not established.',
  },
  other_ingredients_text: 'Purified water, erythritol, pectin, citric acid, natural grapefruit flavor, sucralose.',
  ingredients_text: null,
  contains_statement: 'Contains: Fish',
  business: { text: 'Manufactured for Ownist Co., Ltd., Seoul, Republic of Korea', qualifier: 'Manufactured for' },
  us_contact: { phone: null, address: null },
  claims: ['Supports skin elasticity and hydration'],
  disclaimer_text: null,
  non_english_text_present: true,
  non_english_sample: '콜라겐 젤리 스틱',
  country_of_origin_text: 'Made in Korea',
  barcode_between_required_info: null,
};
