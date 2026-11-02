// Judges a label against the rules table.
// The AI only *reads* the label (lib/extract.js). Every pass/fail decision
// happens here, in plain code, so results are repeatable and explainable.

const has = (v) => typeof v === 'string' && v.trim().length > 0;
const t = (v) => (has(v) ? v.trim() : '');

const METRIC = /\b\d+(?:[.,]\d+)?\s*(?:mg|g|kg|ml|mL|l|L)\b/;
const US_UNIT = /\b\d+(?:[.,]\d+)?\s*(?:fl\.?\s*oz|oz|lb|lbs)\b/i;
const COUNT = /\b\d+\s*(?:sticks?|capsules?|caps|tablets?|softgels?|gummies|packets?|pouches|sachets?|count|ct)\b/i;
const US_PHONE = /(?:\+?1[\s.-]?)?\(?\b[2-9]\d{2}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/;
const US_STATE_ZIP = /\b(?:A[KLRZ]|C[AOT]|D[CE]|FL|GA|HI|I[ADLN]|K[SY]|LA|M[ADEINOST]|N[CDEHJMVY]|O[HKR]|PA|RI|S[CD]|T[NX]|UT|V[AT]|W[AIVY])\s+\d{5}(?:-\d{4})?\b/;
const DISCLAIMER = /not been evaluated by the food and drug administration/i;
const DISEASE_WORDS = /\b(cure[sd]?|treat(?:s|ment)?|prevent(?:s|ion)?|heal[s]?|disease|diabetes|cancer|arthritis|eczema|psoriasis|hypertension|alzheimer'?s|infection|covid)\b/i;
const NUTRIENTS_WITH_FOOTNOTE = /\b(calories|fat|carbohydrate|protein)\b/i;

// Keyword → major allergen (FD&C Act 403(w)). Extend as needed.
const ALLERGENS = {
  milk: /\b(milk|whey|casein|lactose|butter|cream|cheese|yogurt)\b/i,
  egg: /\b(eggs?|albumin)\b/i,
  fish: /\b(fish|marine collagen|cod|salmon|tilapia|pollock|tuna|anchov(?:y|ies)|sardines?)\b/i,
  'crustacean shellfish': /\b(shrimp|crab|lobster|prawn|krill|crayfish)\b/i,
  'tree nuts': /\b(almonds?|walnuts?|cashews?|pecans?|pistachios?|hazelnuts?|macadamia|brazil nuts?|coconut)\b/i,
  peanuts: /\bpeanuts?\b/i,
  wheat: /\b(wheat|spelt|semolina|durum)\b/i,
  soybeans: /\b(soy|soya|soybeans?|tofu|lecithin \(soy\))\b/i,
  sesame: /\bsesame\b/i,
};
const SPECIES_NEEDED = ['fish', 'crustacean shellfish', 'tree nuts'];

function detectAllergens(label) {
  const text = [label.ingredients_text, label.other_ingredients_text,
    ...(label.supplement_facts?.rows ?? []).map((r) => r.name)].map(t).join(' ');
  return Object.entries(ALLERGENS).filter(([, re]) => re.test(text)).map(([name]) => name);
}


// ---------- Supplement Facts format helpers ----------
const rowsOf = (l) => l.supplement_facts?.rows ?? [];
const SUGARS = /^(total\s+)?sugars?\b/i;
// FDA order for the nutrients above the vitamins and minerals.
const MACRO_ORDER = [/^calories/i, /^(total\s+)?fat\b/i, /saturated/i, /trans\s+fat/i, /cholest[e]?rol/i, /sodium/i,
  /carbohydrate/i, /fiber/i, SUGARS, /added\s+sugars/i, /protein/i];
const macroIndex = (name) => MACRO_ORDER.findIndex((re) => re.test(name.trim()));
const NAME_FIXES = [
  [/^carbohydrates?\b/i, 'Total Carbohydrate'],
  [/^sugars?\b/i, 'Total Sugars'],
  [/^fats?\b/i, 'Total Fat'],
  [/^cholestrol\b/i, 'Cholesterol'],
  [/^(vitamin\s*b1|thiamine)\b/i, 'Thiamin'],
  [/^vitamin\s*b2\b/i, 'Riboflavin'],
  [/^vitamin\s*b3\b/i, 'Niacin'],
  [/^vitamin\s*b5\b/i, 'Pantothenic Acid'],
  [/^calcium\s+pantothenate\b/i, 'Pantothenic Acid (as calcium pantothenate)'],
  [/^(vitamin\s*b9|folic acid)\b/i, 'Folate'],
  [/^(vitamin\s*b7|vitamin\s*h)\b/i, 'Biotin'],
];
const escapeRe = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const pass = (evidence) => ({ result: 'pass', evidence });
const fail = (evidence) => ({ result: 'fail', evidence });
const na = (evidence) => ({ result: 'na', evidence });
const manual = (evidence) => ({ result: 'manual', evidence });

// One function per rule_id. A rule in the CSV without a function here is
// shown as "확인 필요" so nothing silently disappears.
export const CHECKS = {
  'US-SUP-001': (l) => {
    const name = t(l.statement_of_identity);
    const front = t(l.front_panel_text);
    if (!name && !front) return fail('앞면에서 제품명을 찾지 못했어요.');
    if (/supplement/i.test(name)) return pass(`"${name}"`);
    const m = front.match(/[^.\n]*\bsupplement\b[^.\n]*/i);
    if (m) return pass(`"${name || 'Product'}" + 앞면의 "${m[0].trim()}"`);
    return fail(`"${name}"와 앞면 어디에도 'Dietary Supplement' 같은 표기가 없어요.`);
  },
  'US-SUP-002': (l) => {
    const q = t(l.net_quantity?.text);
    if (!q) return fail('내용량 표시를 찾지 못했어요.');
    const metric = METRIC.test(q), us = US_UNIT.test(q), count = COUNT.test(q);
    if (metric && !us) return fail(`"${q}"에 미국 단위(oz)가 빠졌어요. 예: 280 g (9.9 oz)`);
    if (us && !metric) return fail(`"${q}"에 미터법 단위(g, mL)가 빠졌어요.`);
    if ((metric && us) || count) return pass(`"${q}"`);
    return fail(`"${q}"에서 무게, 부피, 개수를 찾지 못했어요.`);
  },
  'US-SUP-003': (l) => {
    const pos = l.net_quantity?.in_bottom_30_percent;
    if (pos === true) return pass('앞면 하단 30% 안에 있어요.');
    if (pos === false) return fail('앞면 하단 30% 밖에 있어요.');
    return manual('사진으로 위치를 판단하기 어려워요. 인쇄 파일에서 확인해 주세요.');
  },
  'US-SUP-004': () => manual('앞면 면적과 글자 높이를 인쇄 사양에서 확인해 주세요.'),
  'US-SUP-005': (l, ctx) => (ctx.alternatePanel
    ? manual('다른 앞면에도 제품명과 내용량이 있는지 확인해 주세요.')
    : na('앞면이 하나인 포장이에요.')),
  'US-SUP-006': () => manual('포장 전개도에서 정보 패널이 앞면 바로 오른쪽인지 확인해 주세요.'),
  'US-SUP-007': (l) => {
    const sf = l.supplement_facts;
    if (!sf?.present) return fail('Supplement Facts 패널이 없어요.');
    return /supplement facts/i.test(t(sf.title_text))
      ? pass('"Supplement Facts" 제목이 있어요.')
      : fail(`패널 제목이 "${t(sf.title_text) || '없음'}"이에요. "Supplement Facts"여야 해요.`);
  },
  'US-SUP-008': (l) => {
    const sf = l.supplement_facts ?? {};
    const miss = [!has(sf.serving_size) && 'Serving Size', !has(sf.servings_per_container) && 'Servings Per Container'].filter(Boolean);
    return miss.length ? fail(`${miss.join(', ')} 표기가 없어요.`) : pass(`${sf.serving_size} · ${sf.servings_per_container}`);
  },
  'US-SUP-009': (l) => {
    const rows = l.supplement_facts?.rows ?? [];
    if (!rows.length) return fail('성분별 함량을 찾지 못했어요.');
    const noAmount = rows.filter((r) => !has(r.amount)).map((r) => r.name);
    if (noAmount.length) return fail(`함량이 없는 항목: ${noAmount.join(', ')}`);
    return pass(`${rows.length}개 항목에 함량이 있어요.`);
  },
  'US-SUP-010': (l) => {
    // Calories and sugars have no %DV by design; only dietary ingredients need the † mark.
    const rows = (l.supplement_facts?.rows ?? [])
      .filter((r) => !has(r.dv_percent) && !/calories|sugars|trans fat/i.test(r.name));
    if (!rows.length) return na('Daily Value가 없는 원료가 없어요.');
    const unmarked = rows.filter((r) => !r.marked_dv_not_established).map((r) => r.name);
    if (unmarked.length) return fail(`"Daily Value not established" 표시가 없는 원료: ${unmarked.join(', ')}`);
    return pass(`${rows.map((r) => r.name).join(', ')}에 † 표시가 있어요.`);
  },
  'US-SUP-011': (l) => {
    const rows = l.supplement_facts?.rows ?? [];
    if (!rows.some((r) => NUTRIENTS_WITH_FOOTNOTE.test(r.name))) return na('칼로리·지방·탄수화물·단백질 표기가 없어요.');
    const foot = t(l.supplement_facts?.footnote_text);
    if (/2,?000\s*calorie/i.test(foot)) return pass('%DV 각주가 있어요.');
    const nf = /tells you how much a nutrient/i.test(foot) ? ' 지금 각주는 일반 식품(Nutrition Facts)용 문구예요.' : '';
    return fail(`"Percent Daily Values are based on a 2,000 calorie diet." 각주가 없어요.${nf}`);
  },
  'US-SUP-012': () => manual('패널 테두리, 굵은 선, 글자 크기(8pt/6pt)를 인쇄 파일에서 확인해 주세요.'),
  'US-SUP-013': (l) => (has(l.other_ingredients_text)
    ? pass(`"${t(l.other_ingredients_text).slice(0, 80)}${t(l.other_ingredients_text).length > 80 ? '…' : ''}"`)
    : fail('"Other ingredients" 목록을 찾지 못했어요.')),
  'US-SUP-014': (l) => {
    const b = t(l.business?.text);
    if (!b) return fail('제조사나 유통사 이름과 주소가 없어요.');
    if (US_STATE_ZIP.test(b)) return pass(`"${b}"`);
    return fail(`"${b}" — 미국 내 주소(주, ZIP)가 아니에요. 미국 유통사를 "Distributed by"로 적어야 해요.`);
  },
  'US-SUP-015': (l) => {
    const c = [t(l.us_contact?.phone), t(l.us_contact?.address), t(l.business?.text)].join(' ');
    if (US_PHONE.test(c) || US_STATE_ZIP.test(c)) return pass('미국 연락처가 있어요.');
    return fail('부작용 신고용 미국 주소나 미국 전화번호가 없어요. 없으면 미국에서 부정표시 제품이 돼요.');
  },
  'US-SUP-016': (l) => {
    const found = detectAllergens(l);
    if (!found.length) return na('원재료에서 주요 알레르기 성분을 찾지 못했어요.');
    const contains = t(l.contains_statement);
    const missing = found.filter((a) => !ALLERGENS[a].test(contains) && !contains.toLowerCase().includes(a));
    return missing.length
      ? fail(`원재료에 ${found.join(', ')}이(가) 있는데 "Contains:" 표기에 ${missing.join(', ')}이(가) 없어요.`)
      : pass(`"${t(l.contains_statement)}"`);
  },
  'US-SUP-017': (l) => {
    const need = detectAllergens(l).filter((a) => SPECIES_NEEDED.includes(a));
    if (!need.length) return na('어류·갑각류·견과류 원료가 없어요.');
    const contains = t(l.contains_statement);
    // Species named = the Contains statement still matches once the generic word is removed.
    const generic = /\b(fish|shellfish|crustacean|tree nuts?)\b/gi;
    const missing = need.filter((a) => !ALLERGENS[a].test(contains.replace(generic, '')));
    return missing.length
      ? fail(`${missing.join(', ')}의 종 이름이 없어요. 예: "Contains: Fish (tilapia)"`)
      : pass(`"${contains}"`);
  },
  'US-SUP-018': (l) => (l.barcode_between_required_info === true
    ? fail('정보 패널의 필수 항목 사이에 바코드가 있어요.')
    : manual('글자 높이 1.6mm 이상인지 인쇄 사양에서 확인해 주세요.')),
  'US-SUP-019': (l) => (l.non_english_text_present
    ? manual(`영어 외 문구가 있어요${has(l.non_english_sample) ? ` ("${t(l.non_english_sample).slice(0, 30)}")` : ''}. 그 언어로도 필수 항목이 모두 있어야 해요.`)
    : na('영어로만 표기돼 있어요.')),
  'US-SUP-020': (l) => {
    const claims = (l.claims ?? []).filter(has);
    if (!claims.length) return na('기능성 표현이 없어요.');
    return DISCLAIMER.test(t(l.disclaimer_text))
      ? pass('FDA 면책 문구가 있어요.')
      : fail(`"${claims[0]}" 표현이 있는데 FDA 면책 문구가 없어요.`);
  },
  'US-SUP-021': (l) => {
    const claims = (l.claims ?? []).filter(has);
    if (!claims.length) return na('기능성 표현이 없어요.');
    const risky = claims.filter((c) => DISEASE_WORDS.test(c));
    return risky.length ? fail(`질병 관련 표현으로 보일 수 있어요: "${risky.join('", "')}"`) : pass('질병 치료·예방 표현이 없어요.');
  },
  'US-SUP-022': (l) => ((l.claims ?? []).some(has)
    ? manual('기능성 표현으로 처음 판매한 날부터 30일 안에 FDA에 신고해야 해요.')
    : na('기능성 표현이 없어요.')),
  'US-SUP-024': (l) => {
    const zero = rowsOf(l).filter((r) => macroIndex(r.name) >= 0 && parseFloat(t(r.amount).replace(',', '')) === 0);
    if (!rowsOf(l).length) return na('성분표가 없어요.');
    return zero.length
      ? fail(`함량이 0인 항목이 있어요: ${zero.map((r) => `${r.name} ${r.amount}`).join(', ')}. 관련 표현이 없으면 빼는 게 일반적이에요.`)
      : pass('0인 항목이 없어요.');
  },
  'US-SUP-025': (l) => {
    const s = rowsOf(l).filter((r) => SUGARS.test(r.name.trim()));
    if (!s.length) return na('당류 표기가 없어요.');
    const withDv = s.filter((r) => has(r.dv_percent));
    return withDv.length ? fail(`${withDv[0].name} 옆에 %DV(${withDv[0].dv_percent})가 있어요. 미국은 총당류에 %DV가 없어요.`) : pass('당류에 %DV가 없어요.');
  },
  'US-SUP-026': (l) => {
    const fixes = [];
    for (const r of rowsOf(l)) {
      const hit = NAME_FIXES.find(([re]) => re.test(r.name.trim()));
      if (hit) fixes.push(`"${r.name}" → "${hit[1]}"`);
    }
    const spc = t(l.supplement_facts?.servings_per_container);
    if (spc && !/servings\s+per\s+container/i.test(spc)) fixes.push(`"${spc.replace(/[:\s\d]+$/, '')}" → "Servings Per Container"`);
    return fixes.length ? fail(`미국 표준 이름으로 바꿔야 해요: ${fixes.join(', ')}`) : pass('미국 표준 이름을 쓰고 있어요.');
  },
  'US-SUP-027': (l) => {
    const cal = rowsOf(l).find((r) => /^calories/i.test(r.name.trim()));
    if (!cal) return na('칼로리 표기가 없어요.');
    return /cal|kj/i.test(t(cal.amount)) ? fail(`"${cal.amount}" → 단위 없이 "Calories ${parseFloat(t(cal.amount)) || ''}"로 적어요.`) : pass(`Calories ${cal.amount}`);
  },
  'US-SUP-028': (l) => {
    const rows = rowsOf(l);
    if (!rows.length) return na('성분표가 없어요.');
    let maxIdx = -1, maxName = '';
    for (const r of rows) {
      const idx = macroIndex(r.name);
      const rank = idx >= 0 ? idx : MACRO_ORDER.length; // vitamins, minerals, others come after
      if (rank < maxIdx) return fail(`"${r.name}"이(가) "${maxName}"보다 앞에 와야 해요. 순서: Calories → Total Fat → Sodium → Total Carbohydrate → Total Sugars → Protein → 비타민·미네랄`);
      if (rank > maxIdx) { maxIdx = rank; maxName = r.name; }
    }
    return pass('표준 순서를 따르고 있어요.');
  },
  'US-SUP-029': (l) => {
    const symbols = [...new Set(rowsOf(l).map((r) => t(r.dv_symbol)).filter(Boolean))];
    if (!symbols.length) return na('%DV 열에 기호가 없어요.');
    const foot = t(l.supplement_facts?.footnote_text);
    const missing = symbols.filter((sym) => {
      const c = escapeRe(sym[0]);
      return !new RegExp(`(?<!${c})${escapeRe(sym)}(?!${c})`).test(foot);
    });
    return missing.length
      ? fail(`표에서 쓴 기호 ${missing.join(', ')}에 맞는 각주가 없어요. 예: "${missing[0]} Daily Value not established."`)
      : pass(`기호 ${symbols.join(', ')}의 각주가 있어요.`);
  },
  'US-SUP-030': (l) => {
    const bad = rowsOf(l).filter((r) => /\b(NE|RE|IU)\b|α-?TE|\ba-TE\b/i.test(t(r.amount)));
    return bad.length
      ? fail(`미국 라벨에서 쓰지 않는 단위가 있어요: ${bad.map((r) => `${r.name} ${r.amount}`).join(', ')}`)
      : pass('g, mg, mcg 단위를 쓰고 있어요.');
  },
  'US-SUP-023': (l) => {
    const o = t(l.country_of_origin_text);
    return /(made in|product of)\s+(the\s+)?(republic of\s+)?korea/i.test(o)
      ? pass(`"${o}"`)
      : fail(o ? `"${o}" — "Made in Korea"처럼 영어로 적어야 해요.` : '원산지 표기가 없어요.');
  },
};

// Which part of the package a rule needs to see. If that part is not in the
// photos, a non-passing result becomes "사진에 없음" instead of "누락".
const NEEDS = {
  front: ['US-SUP-001', 'US-SUP-002', 'US-SUP-003'],
  info: ['US-SUP-013', 'US-SUP-014', 'US-SUP-015', 'US-SUP-016', 'US-SUP-017', 'US-SUP-018'],
  whole: ['US-SUP-019', 'US-SUP-020', 'US-SUP-021', 'US-SUP-022', 'US-SUP-023'],
};
const UNSEEN_NOTE = {
  front: '앞면이 사진에 없어서 판단하지 못했어요. 앞면 사진을 추가해 주세요.',
  info: '정보 패널 전체가 사진에 없어서 판단하지 못했어요. Supplement Facts 주변까지 보이게 찍어 주세요.',
  whole: '포장 전체가 사진에 없어서 판단하지 못했어요. 앞면과 모든 옆면 사진을 추가해 주세요.',
};
function hiddenPart(ruleId, label) {
  const v = label.visible;
  if (!v) return null;
  const front = v.front_panel !== false, info = v.information_panel_complete !== false;
  if (NEEDS.front.includes(ruleId) && !front) return 'front';
  if (NEEDS.info.includes(ruleId) && !info) return 'info';
  if (NEEDS.whole.includes(ruleId) && !(front && info)) return 'whole';
  if (v.supplement_facts === false && /^US-SUP-(0(0[7-9]|1[0-2])|02[4-9]|030)$/.test(ruleId)) return 'info';
  return null;
}

export function evaluate(label, rules, ctx = {}) {
  const items = rules.map((rule) => {
    const check = CHECKS[rule.rule_id];
    let { result, evidence } = check ? check(label, ctx) : manual('아직 자동 판정이 없는 규칙이에요.');
    const hidden = result !== 'pass' ? hiddenPart(rule.rule_id, label) : null;
    if (hidden) {
      const found = ['US-SUP-016', 'US-SUP-017'].includes(rule.rule_id) ? detectAllergens(label) : [];
      const extra = found.length ? ` 성분표에 ${found.join(', ')} 원료가 보여요. "Contains: ${found[0] === 'fish' ? 'Fish (종 이름)' : found[0]}" 표기가 꼭 있는지 확인해 주세요.` : '';
      return { ...rule, status: 'unseen', evidence: UNSEEN_NOTE[hidden] + extra };
    }
    const status = result === 'pass' ? 'pass'
      : result === 'na' ? 'na'
      : result === 'manual' ? 'check'
      : rule.severity_if_fail === 'missing' ? 'missing' : 'check';
    return { ...rule, status, evidence };
  });
  const counts = { missing: 0, check: 0, pass: 0, unseen: 0, na: 0 };
  items.forEach((i) => counts[i.status]++);
  const applicable = counts.missing + counts.check + counts.pass;
  const score = applicable ? counts.pass / applicable : 1;
  // Tag face: 0 crying → 4 big smile
  const face = counts.missing >= 4 ? 0 : counts.missing >= 2 ? 1 : counts.missing === 1 ? 2 : counts.check > 3 ? 3 : 4;
  return { items, counts, score, face };
}
