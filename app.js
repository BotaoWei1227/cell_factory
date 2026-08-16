const API_ROOT = 'https://pillars-of-creation.funtuan.work/api/nodes';
const $ = (selector) => document.querySelector(selector);
let lastResult = null;

function cleanWords(text) {
  return [...new Set(text.split(/[\s,，、]+/).map((word) => word.trim()).filter(Boolean))];
}

function escapeHtml(text = '') {
  return String(text).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function endpoint(word, suffix = '') {
  return `${API_ROOT}/${encodeURIComponent(word)}${suffix}`;
}

function proxied(url, prefix) {
  return prefix.trim() ? `${prefix.trim()}${encodeURIComponent(url)}` : url;
}

function stateLabel(state) {
  return {
    owned: '已有材料',
    unavailable: '找不到公開配方',
    limit: '到達搜尋上限',
    cycle: '略過循環',
  }[state] || '';
}

function treeSize(plan) {
  return 1 + plan.children.reduce((sum, child) => sum + treeSize(child), 0);
}

function unresolvedLeaves(plan) {
  if (!plan.children.length) return plan.state === 'owned' ? 0 : 1;
  return plan.children.reduce((sum, child) => sum + unresolvedLeaves(child), 0);
}

function score(plan) {
  return [plan.height, unresolvedLeaves(plan), plan.leaves, treeSize(plan)];
}

function compareScore(a, b) {
  const aScore = score(a);
  const bScore = score(b);
  for (let index = 0; index < aScore.length; index += 1) {
    if (aScore[index] !== bScore[index]) return aScore[index] - bScore[index];
  }
  return 0;
}

class RecipeFinder {
  constructor({ proxy, maxNodes, recipeLimit, owned }) {
    this.proxy = proxy;
    this.maxNodes = maxNodes;
    this.recipeLimit = recipeLimit;
    this.owned = owned;
    this.cache = new Map();
    this.pending = new Map();
    this.limitHit = false;
  }

  async getJson(url) {
    const response = await fetch(proxied(url, this.proxy));
    if (!response.ok) throw new Error(`API 回應 ${response.status}`);
    return response.json();
  }

  async fetchNode(word) {
    if (this.cache.has(word)) return this.cache.get(word);
    if (this.pending.has(word)) return this.pending.get(word);
    if (this.cache.size >= this.maxNodes) {
      this.limitHit = true;
      return { word, emoji: '', recipes: [], limited: true };
    }
    const request = (async () => {
      try {
        const [detailResponse, recipeResponse] = await Promise.all([
          this.getJson(endpoint(word)),
          this.getJson(endpoint(word, '/recipes')),
        ]);
        const detail = detailResponse.node || {};
        const unique = new Set();
        const recipes = [...(recipeResponse.recipes || []), ...(detail.recipes || [])]
          .filter((recipe) => recipe.a && recipe.b)
          .filter((recipe) => {
            const key = `${recipe.a}\u0000${recipe.b}`;
            if (unique.has(key)) return false;
            unique.add(key);
            return true;
          })
          .slice(0, this.recipeLimit)
          .map((recipe) => ({ left: recipe.a, right: recipe.b, leftEmoji: recipe.aEmoji || '', rightEmoji: recipe.bEmoji || '' }));
        const node = { word, emoji: detail.emoji || '', recipes, limited: false };
        this.cache.set(word, node);
        return node;
      } catch (error) {
        const node = { word, emoji: '', recipes: [], limited: false, error: error.message };
        this.cache.set(word, node);
        return node;
      } finally {
        this.pending.delete(word);
      }
    })();
    this.pending.set(word, request);
    return request;
  }

  async solve(word, remaining, trail = []) {
    const node = await this.fetchNode(word);
    if (this.owned.has(word)) return { word, emoji: node.emoji, recipe: null, children: [], height: 0, leaves: 1, state: 'owned' };
    if (trail.includes(word)) return { word, emoji: node.emoji, recipe: null, children: [], height: 0, leaves: 1, state: 'cycle' };
    if (node.limited) return { word, emoji: node.emoji, recipe: null, children: [], height: 0, leaves: 1, state: 'limit' };
    if (remaining === 0) return { word, emoji: node.emoji, recipe: null, children: [], height: 0, leaves: 1, state: 'limit' };
    if (!node.recipes.length) return { word, emoji: node.emoji, recipe: null, children: [], height: 0, leaves: 1, state: 'unavailable' };

    const options = await Promise.all(node.recipes.map(async (recipe) => {
      const [left, right] = await Promise.all([
        this.solve(recipe.left, remaining - 1, [...trail, word]),
        this.solve(recipe.right, remaining - 1, [...trail, word]),
      ]);
      return { word, emoji: node.emoji, recipe, children: [left, right], height: 1 + Math.max(left.height, right.height), leaves: left.leaves + right.leaves, state: 'recipe' };
    }));
    return options.sort(compareScore)[0];
  }
}

function renderPlan(plan) {
  const label = `${plan.emoji ? `${escapeHtml(plan.emoji)} ` : ''}${escapeHtml(plan.word)}`;
  const badge = plan.state === 'recipe' ? '' : `<span class="badge ${plan.state}">${stateLabel(plan.state)}</span>`;
  if (!plan.children.length) return `<li><div class="tree-node"><span class="node-name">${label}</span>${badge}</div></li>`;
  const recipe = `${escapeHtml(plan.recipe.left)} + ${escapeHtml(plan.recipe.right)}`;
  return `<li><details open><summary><span class="tree-node"><span class="node-name">${label}</span><span class="recipe">${recipe} →</span></span></summary><ul>${plan.children.map(renderPlan).join('')}</ul></details></li>`;
}

function textTree(plan, prefix = '', isLast = true) {
  const label = `${plan.emoji ? `${plan.emoji} ` : ''}${plan.word}${plan.state === 'recipe' ? '' : ` [${stateLabel(plan.state)}]`}`;
  const lines = [`${prefix}${isLast ? '└─' : '├─'} ${label}`];
  const childPrefix = `${prefix}${isLast ? '   ' : '│  '}`;
  plan.children.forEach((child, index) => lines.push(...textTree(child, childPrefix, index === plan.children.length - 1)));
  return lines;
}

function setBusy(busy, message) {
  $('#searchButton').disabled = busy;
  $('#searchButton').innerHTML = busy ? '<span class="spinner"></span> 查詢中…' : '<span>✦</span> 尋找最短配方';
  $('#status').textContent = message;
}

async function search(event) {
  event.preventDefault();
  const target = $('#targetInput').value.trim();
  if (!target) return;
  const maxDepth = Number($('#depthInput').value);
  const maxNodes = Number($('#nodeLimitInput').value);
  const recipeLimit = Number($('#recipeLimitInput').value);
  const finder = new RecipeFinder({ proxy: $('#proxyInput').value, maxNodes, recipeLimit, owned: new Set(cleanWords($('#ownedInput').value)) });
  $('#result').classList.add('hidden');
  setBusy(true, `正在追溯「${target}」的公開配方…`);
  try {
    const plan = await finder.solve(target, maxDepth);
    lastResult = { target, plan, crawledNodes: finder.cache.size, settings: { maxDepth, maxNodes, recipeLimit } };
    $('#heightMetric').textContent = plan.height;
    $('#leafMetric').textContent = plan.leaves;
    $('#nodeMetric').textContent = finder.cache.size;
    $('#tree').innerHTML = `<ul>${renderPlan(plan)}</ul>`;
    $('#result').classList.remove('hidden');
    const suffix = finder.limitHit ? ' 已達造物上限；可提高「最多造物」再試。' : '';
    setBusy(false, `完成：已查詢 ${finder.cache.size} 個造物。${suffix}`);
  } catch (error) {
    setBusy(false, `查詢失敗：${error.message}。請確認 CORS proxy 設定後重試。`);
  }
}

$('#searchForm').addEventListener('submit', search);
$('#exampleButton').addEventListener('click', () => {
  $('#targetInput').value = '機器人';
  $('#ownedInput').value = '鋼鐵、AI晶片';
  $('#depthInput').value = 4;
});
$('#copyButton').addEventListener('click', async () => {
  if (!lastResult) return;
  await navigator.clipboard.writeText(textTree(lastResult.plan).join('\n'));
  $('#copyButton').textContent = '已複製';
  setTimeout(() => { $('#copyButton').textContent = '複製文字樹'; }, 1500);
});
$('#downloadButton').addEventListener('click', () => {
  if (!lastResult) return;
  const blob = new Blob([JSON.stringify(lastResult, null, 2)], { type: 'application/json;charset=utf-8' });
  const link = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `${lastResult.target}-shortest-tree.json` });
  link.click();
  URL.revokeObjectURL(link.href);
});
