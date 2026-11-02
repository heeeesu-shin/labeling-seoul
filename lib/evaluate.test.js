import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRules } from './rules.js';
import { evaluate, CHECKS } from './evaluate.js';
import { SAMPLE_LABEL, mergeLabels } from './extract.js';

const rules = loadRules();
const byId = (r) => Object.fromEntries(r.items.map((i) => [i.rule_id, i.status]));

test('every rule in the CSV has a check', () => {
  assert.equal(rules.length, 30);
  for (const r of rules) assert.ok(CHECKS[r.rule_id], `no check for ${r.rule_id}`);
});

test('sample label: finds the expected gaps', () => {
  const s = byId(evaluate(SAMPLE_LABEL, rules));
  assert.equal(s['US-SUP-001'], 'pass');
  assert.equal(s['US-SUP-002'], 'missing'); // 280 g without oz
  assert.equal(s['US-SUP-010'], 'missing'); // hyaluronic acid has no †
  assert.equal(s['US-SUP-011'], 'missing'); // no 2,000 calorie footnote
  assert.equal(s['US-SUP-014'], 'missing'); // Korean address only
  assert.equal(s['US-SUP-015'], 'missing'); // no US contact
  assert.equal(s['US-SUP-016'], 'pass');    // "Contains: Fish"
  assert.equal(s['US-SUP-017'], 'missing'); // fish species not named
  assert.equal(s['US-SUP-020'], 'missing'); // claim without disclaimer
  assert.equal(s['US-SUP-021'], 'pass');
  assert.equal(s['US-SUP-023'], 'pass');
});

test('fixed label: all automatic rules pass', () => {
  const fixed = structuredClone(SAMPLE_LABEL);
  fixed.net_quantity.text = '14 Sticks · Net Wt 280 g (9.9 oz)';
  fixed.supplement_facts.rows[4].marked_dv_not_established = true;
  fixed.business.text = 'Distributed by Ownist USA Inc., 123 Main St, Los Angeles, CA 90012';
  fixed.us_contact.phone = '(213) 555-0147';
  fixed.supplement_facts.footnote_text = '* Percent Daily Values are based on a 2,000 calorie diet. † Daily Value not established.';
  fixed.contains_statement = 'Contains: Fish (tilapia)';
  fixed.disclaimer_text = '*This statement has not been evaluated by the Food and Drug Administration. This product is not intended to diagnose, treat, cure, or prevent any disease.';
  const r = evaluate(fixed, rules);
  assert.equal(r.counts.missing, 0);
  assert.equal(r.face, 3);
});

test('disease claim is flagged', () => {
  const l = structuredClone(SAMPLE_LABEL);
  l.claims = ['Helps prevent arthritis'];
  assert.equal(byId(evaluate(l, rules))['US-SUP-021'], 'check');
});

// Ownist Triple Shine (grape): Supplement Facts image only, as tested on 2026-10-28.
const TRIPLE_SHINE = {
  visible: { front_panel: false, supplement_facts: true, information_panel_complete: false },
  statement_of_identity: null,
  net_quantity: { text: null, in_bottom_30_percent: null },
  supplement_facts: {
    present: true,
    title_text: 'Supplement Facts',
    serving_size: 'Serving Size : 1 packet (15 g / 0.52 oz)',
    servings_per_container: 'Serving per container : 14',
    rows: [
      { name: 'Calories', amount: '25 Kcal', dv_percent: null, marked_dv_not_established: false, dv_symbol: null },
      { name: 'Sodium', amount: '5 mg', dv_percent: '0%', marked_dv_not_established: false, dv_symbol: null },
      { name: 'Carbohydrates', amount: '6 g', dv_percent: '1%', marked_dv_not_established: false, dv_symbol: null },
      { name: 'Sugar', amount: '4 g', dv_percent: '8%', marked_dv_not_established: false, dv_symbol: null },
      { name: 'Total Fat', amount: '0 g', dv_percent: '0%', marked_dv_not_established: false, dv_symbol: null },
      { name: 'Vitamin B2', amount: '1.4 mg', dv_percent: '107%', marked_dv_not_established: false, dv_symbol: null },
      { name: 'Niacin(Vitamin B3)', amount: '15 mg NE', dv_percent: '93%', marked_dv_not_established: false, dv_symbol: null },
      { name: 'Calcium Pantothenate (Vitamin B5)', amount: '5.43 mg', dv_percent: '108%', marked_dv_not_established: false, dv_symbol: null },
      { name: 'Vitamin B6', amount: '1.5 mg', dv_percent: '88%', marked_dv_not_established: false, dv_symbol: null },
      { name: 'Vitamin C', amount: '100 mg', dv_percent: '111%', marked_dv_not_established: false, dv_symbol: null },
      { name: 'Belight® (Grape extract, Licorice extract)', amount: '300 mg', dv_percent: null, marked_dv_not_established: true, dv_symbol: '†' },
    ],
    footnote_text: '* % Daily Value tells you how much a nutrient in a serving of food contributes to a daily diet. ** Daily values are not established.',
  },
  other_ingredients_text: null, ingredients_text: null, contains_statement: null,
  business: { text: null, qualifier: null }, us_contact: { phone: null, address: null },
  claims: [], disclaimer_text: null, non_english_text_present: false, non_english_sample: null,
  country_of_origin_text: null, barcode_between_required_info: null,
};

test('Triple Shine panel: out-of-frame items are "unseen", panel format issues are found', () => {
  const r = evaluate(TRIPLE_SHINE, loadRules());
  const s = byId(r);
  for (const id of ['US-SUP-001', 'US-SUP-002', 'US-SUP-013', 'US-SUP-014', 'US-SUP-015', 'US-SUP-023']) assert.equal(s[id], 'unseen', id);
  assert.equal(s['US-SUP-007'], 'pass');
  assert.equal(s['US-SUP-010'], 'pass');
  assert.equal(s['US-SUP-011'], 'missing');
  assert.equal(s['US-SUP-024'], 'check');   // Total Fat 0 g
  assert.equal(s['US-SUP-025'], 'missing'); // Sugar 8%
  assert.equal(s['US-SUP-026'], 'missing'); // names
  assert.equal(s['US-SUP-027'], 'missing'); // 25 Kcal
  assert.equal(s['US-SUP-028'], 'check');   // Total Fat after carbs
  assert.equal(s['US-SUP-029'], 'missing'); // † vs **
  assert.equal(s['US-SUP-030'], 'check');   // mg NE
  const names = r.items.find((i) => i.rule_id === 'US-SUP-026').evidence;
  for (const want of ['Total Carbohydrate', 'Total Sugars', 'Riboflavin', 'Pantothenic Acid', 'Servings Per Container']) assert.ok(names.includes(want), want);
  console.log(r.counts);
});

// Ownist Triple Collagen (orange): three photos read one by one, as on 2026-10-29.
const empty = () => ({
  visible: { front_panel: false, supplement_facts: false, information_panel_complete: false },
  statement_of_identity: null, front_panel_text: null,
  net_quantity: { text: null, in_bottom_30_percent: null },
  supplement_facts: { present: false, title_text: null, serving_size: null, servings_per_container: null, rows: [], footnote_text: null },
  other_ingredients_text: null, ingredients_text: null, contains_statement: null,
  business: { text: null, qualifier: null }, us_contact: { phone: null, address: null },
  claims: [], disclaimer_text: null, non_english_text_present: false, non_english_sample: null,
  country_of_origin_text: null, barcode_between_required_info: null,
});
const row = (name, amount, dv, sym = null) => ({ name, amount, dv_percent: dv, marked_dv_not_established: !!sym, dv_symbol: sym });
const photoFront = { ...empty(),
  visible: { front_panel: true, supplement_facts: false, information_panel_complete: false },
  statement_of_identity: 'Triple Collagen orange',
  front_panel_text: 'Ownist\nTriple Collagen orange\nSkin | Firm & Hydrated\nDietary Supplement\n20g X 14 Packets / Net Wt. 9.88oz (280g)',
  net_quantity: { text: '20g X 14 Packets / Net Wt. 9.88oz (280g)', in_bottom_30_percent: true },
  claims: ['Skin', 'Firm & Hydrated'], non_english_text_present: true, non_english_sample: '콜라겐' };
const photoFacts = { ...empty(),
  visible: { front_panel: false, supplement_facts: true, information_panel_complete: false },
  supplement_facts: {
    present: true, title_text: 'Supplement Facts',
    serving_size: 'Serving Size : 1 packet (20g / 0.71 FL oz)', servings_per_container: 'Serving per container : 14',
    rows: [row('Calories', '25 Kcal', null), row('Carbohydrates', '6 g', '2%'), row('Sugar', 'Less than 1 g', '1%'),
      row('Protein', '2 g', '4%'), row('Fat', '0 g', '0%'), row('Cholestrol', '0 mg', '0%'), row('Sodium', '5 mg', '0%'),
      row('Hydrolyzed Marine Collagen', '3000 mg', null, '†'), row('Vitamin C (Ascorbic Acid)', '200 mg', '222%'),
      row('Hyaluronic Acid', '120 mg', null, '†'), row('Elastin', '100 mg', null, '†')],
    footnote_text: '* Percent Daily Values (DV) are based on a 2,000 calorie diet. ** Daily Value not established.',
  } };
const photoMarketing = { ...empty(),
  visible: { front_panel: true, supplement_facts: false, information_panel_complete: false },
  statement_of_identity: 'Triple Collagen orange',
  claims: ["Korea's #1 Premium Beauty Collagen", 'Firm & Hydrated'] };

test('Triple Collagen: per-photo readings merge and the panel is judged', () => {
  const merged = mergeLabels([photoFront, photoFacts, photoMarketing]);
  assert.equal(merged.supplement_facts.rows.length, 11);
  assert.equal(merged.visible.supplement_facts, true);
  assert.equal(merged.visible.front_panel, true);
  const r = evaluate(merged, loadRules());
  const s = byId(r);
  assert.equal(s['US-SUP-001'], 'pass');    // "Dietary Supplement" on front
  assert.equal(s['US-SUP-002'], 'pass');
  assert.equal(s['US-SUP-007'], 'pass');
  assert.equal(s['US-SUP-011'], 'pass');    // 2,000 calorie footnote present
  assert.equal(s['US-SUP-024'], 'check');   // Fat 0 g, Cholesterol 0 mg
  assert.equal(s['US-SUP-025'], 'missing'); // Sugar 1%
  assert.equal(s['US-SUP-026'], 'missing');
  assert.equal(s['US-SUP-027'], 'missing');
  assert.equal(s['US-SUP-028'], 'check');
  assert.equal(s['US-SUP-029'], 'missing'); // † vs **
  assert.equal(s['US-SUP-016'], 'unseen');  // marine collagen = fish, but Contains: line not in photos
  const names = r.items.find((i) => i.rule_id === 'US-SUP-026').evidence;
  assert.ok(names.includes('"Cholestrol" → "Cholesterol"'));
  console.log(r.counts);
});
