const $ = (id) => document.getElementById(id);
const STATUS = {
  missing: { label: '누락', order: 0 },
  check: { label: '확인 필요', order: 1 },
  unseen: { label: '사진에 없음', order: 2 },
  pass: { label: '통과', order: 3 },
  na: { label: '해당 없음', order: 4 },
};
const PANEL = { front: '앞면', info: '정보 패널', claim: '표현', process: '절차' };
const MAX = 5;
let picked = [];     // [{ base64, mediaType, url }]
let lastResult = null;
let filter = 'all';

// ---------- upload ----------
const fileInput = $('file');
fileInput.addEventListener('change', () => { addFiles([...fileInput.files]); fileInput.value = ''; });
const drop = $('drop');
['dragenter', 'dragover'].forEach((e) => drop.addEventListener(e, (ev) => { ev.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((e) => drop.addEventListener(e, () => drop.classList.remove('over')));
drop.addEventListener('drop', (ev) => { ev.preventDefault(); addFiles([...ev.dataTransfer.files]); });

async function addFiles(files) {
  showError('');
  const images = files.filter((f) => /^image\/(jpeg|png|webp)$/.test(f.type));
  if (images.length < files.length) showError('JPG, PNG, WEBP 이미지만 올릴 수 있어요. PDF는 이미지로 내보낸 뒤 올려 주세요.');
  const room = MAX - picked.length;
  if (images.length > room) showError(`사진은 ${MAX}장까지 올릴 수 있어요.`);
  for (const f of images.slice(0, Math.max(0, room))) {
    try { picked.push(await shrink(f)); } catch { showError('이미지를 열지 못했어요. 다른 파일로 시도해 주세요.'); }
  }
  renderThumbs();
}

function renderThumbs() {
  const ul = $('thumbs');
  ul.hidden = !picked.length;
  ul.innerHTML = picked.map((p, i) => `<li><img src="data:${p.mediaType};base64,${p.base64}" alt="라벨 사진 ${i + 1}"><span class="n">${i + 1}</span><button type="button" data-i="${i}" aria-label="사진 ${i + 1} 빼기">×</button></li>`).join('');
  ul.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { picked.splice(+b.dataset.i, 1); renderThumbs(); }));
  $('run').disabled = !picked.length;
  $('run').textContent = picked.length ? `사진 ${picked.length}장 검사하기` : '검사하기';
}

// Keep uploads small enough for serverless limits while staying readable.
function shrink(file, max = 1600) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
      const g = c.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
      g.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve({ base64: c.toDataURL('image/jpeg', 0.85).split(',')[1], mediaType: 'image/jpeg' });
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

$('run').addEventListener('click', () => picked.length && check({ images: picked }));
$('sample').addEventListener('click', () => check({ sample: true }));
$('again').addEventListener('click', () => {
  $('results').hidden = true; $('upload').hidden = false;
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

async function check(payload) {
  showError('');
  $('upload').hidden = true; $('results').hidden = true; $('loading').hidden = false;
  try {
    const res = await fetch('/api/check', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...payload, alternatePanel: $('alt').checked }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || '검사하지 못했어요. 잠시 후 다시 시도해 주세요.');
    lastResult = data; filter = 'all';
    render();
    $('results').hidden = false;
  } catch (err) {
    $('upload').hidden = false;
    showError(err.message);
  } finally {
    $('loading').hidden = true;
  }
}

function showError(msg) { $('error').textContent = msg; $('error').hidden = !msg; }

// ---------- results ----------
function render() {
  const { items, counts, face, sample } = lastResult;
  $('face').innerHTML = tagFace(face);
  $('sampleNote').textContent = sample ? '샘플: 오니스트 콜라겐 젤리 스틱 미국 라벨 초안' : '올린 라벨 · 미국 건강기능식품 규정';
  $('headline').textContent = counts.missing
    ? `고쳐야 할 항목이 ${counts.missing}개 있어요`
    : counts.check ? `누락은 없어요. ${counts.check}개만 직접 확인해 주세요` : '모든 항목을 통과했어요';
  $('counts').innerHTML = ['missing', 'check', 'unseen', 'pass', 'na']
    .filter((s) => counts[s] || s !== 'unseen')
    .map((s) => `<span class="count s-${s}">${STATUS[s].label} ${counts[s]}</span>`).join('')
    + (counts.unseen ? `<p class="hint-add">사진에 안 보인 면이 있어서 ${counts.unseen}개 항목은 판단하지 못했어요. 앞면과 옆면 사진을 추가하면 더 정확해져요.</p>` : '');

  const tabs = [['all', `전체 ${items.length}`], ...['missing', 'check', 'unseen', 'pass', 'na'].filter((s) => counts[s]).map((s) => [s, `${STATUS[s].label} ${counts[s]}`])];
  $('filters').innerHTML = tabs.map(([k, l]) => `<button class="chip" role="tab" data-f="${k}" aria-selected="${filter === k}">${l}</button>`).join('');
  $('filters').querySelectorAll('.chip').forEach((b) => b.addEventListener('click', () => { filter = b.dataset.f; render(); }));

  const shown = items
    .filter((i) => filter === 'all' || i.status === filter)
    .sort((a, b) => STATUS[a.status].order - STATUS[b.status].order);
  $('items').innerHTML = shown.map(itemHtml).join('');
  renderReadout(lastResult.label);
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function itemHtml(i) {
  return `<li class="item st-${i.status}">
    <span class="pill s-${i.status}">${STATUS[i.status].label}</span>
    <h3>${esc(i.title_ko)} <code>${esc(i.rule_id)} · ${PANEL[i.panel] ?? ''}</code></h3>
    <p class="evidence">${esc(i.evidence)}</p>
    <details><summary>규정 내용</summary><p>${esc(i.requirement_en)}</p>${i.applies_when !== 'always' ? `<p>적용 조건: ${esc(i.applies_when)}</p>` : ''}</details>
    <span class="src">근거: <a href="${esc(i.source_url)}" target="_blank" rel="noopener">${esc(i.source_ref)}</a></span>
  </li>`;
}

function renderReadout(l) {
  const sf = l.supplement_facts ?? {};
  const v = l.visible;
  const seen = v ? [v.front_panel && '앞면', v.supplement_facts && 'Supplement Facts', v.information_panel_complete && '정보 패널 전체'].filter(Boolean).join(', ') : '';
  const rows = [
    ['사진에서 본 면', seen],
    ['제품명', l.statement_of_identity],
    ['내용량', l.net_quantity?.text],
    ['Supplement Facts', sf.present ? [sf.serving_size, sf.servings_per_container].filter(Boolean).join(' · ') : null],
    ['성분', (sf.rows ?? []).map((r) => `${r.name} ${r.amount ?? ''}${r.dv_percent ? ` (${r.dv_percent})` : r.marked_dv_not_established ? ' †' : ''}`).join(', ')],
    ['각주', sf.footnote_text],
    ['Other ingredients', l.other_ingredients_text],
    ['알레르기 표기', l.contains_statement],
    ['제조·유통사', l.business?.text],
    ['미국 연락처', [l.us_contact?.phone, l.us_contact?.address].filter(Boolean).join(' · ')],
    ['기능성 표현', (l.claims ?? []).join(' / ')],
    ['FDA 면책 문구', l.disclaimer_text],
    ['원산지', l.country_of_origin_text],
  ];
  $('readout').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd class="${v ? '' : 'empty'}">${v ? esc(v) : '읽지 못함 / 없음'}</dd>`).join('');
}

// Hang-tag face: 0 crying → 4 big smile
function tagFace(stage) {
  const fill = stage === 4 ? '#2F5FD0' : '#FFFFFF';
  const fg = stage === 4 ? '#FFFFFF' : '#1E1E1E';
  const mouths = [
    'M38 66 Q48 58 58 66', // 0 crying
    'M39 65 Q48 60 57 65', // 1 frown
    'M39 63 L57 63',       // 2 flat
    'M39 61 Q48 66 57 61', // 3 slight smile
    'M37 60 Q48 72 59 60', // 4 big smile
  ];
  const tear = stage === 0 ? '<path d="M35 50 q-3 6 0 9 q3 -3 0 -9z" fill="#2F5FD0"/>' : '';
  return `<svg viewBox="0 0 96 96" role="img" aria-label="라벨 상태 ${stage + 1}/5">
    <path d="M22 12h40l18 18v52a4 4 0 0 1-4 4H22a4 4 0 0 1-4-4V16a4 4 0 0 1 4-4z" fill="${fill}" stroke="#1E1E1E" stroke-width="3" stroke-linejoin="round"/>
    <circle cx="64" cy="28" r="5" fill="#F5F4F0" stroke="#1E1E1E" stroke-width="3"/>
    <path d="M64 23 C70 8 84 6 90 2" stroke="#1E1E1E" stroke-width="3" fill="none" stroke-linecap="round"/>
    <circle cx="38" cy="46" r="3.4" fill="${fg}"/><circle cx="58" cy="46" r="3.4" fill="${fg}"/>
    <path d="${mouths[stage]}" stroke="${fg}" stroke-width="3.4" fill="none" stroke-linecap="round"/>${tear}
  </svg>`;
}
