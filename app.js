const storageKey = 'cell-factory-ai-v3';
const apiStorageKey = 'cell-factory-api';

const oceanDrops = [
    '磷脂質',
    '脂肪酸',
    '磷酸鹽',
    '核苷酸',
    '胺基酸',
    'ATP',
    '葡萄糖',
    '氧氣',
    '好氧細菌'
];

const initial = {
    inventory: {},
    board: Array(25).fill(null),
    achievements: []
};

let state =
    JSON.parse(localStorage.getItem(storageKey) || 'null') ||
    structuredClone(initial);

let selected = null;
let timer = null;

const $ = s => document.querySelector(s);

function save() {
    localStorage.setItem(storageKey, JSON.stringify(state));
}

function add(name, n = 1) {
    state.inventory[name] = (state.inventory[name] || 0) + n;
}

function achievement(id, title) {
    if (!state.achievements.includes(id)) {
        state.achievements.push(id);
        notify(`成就解鎖：${title}`);
    }
}

function status() {
    if (state.achievements.includes('division'))
        return ['可分裂細胞', '第一次細胞分裂已完成。'];

    if (state.achievements.includes('organelle'))
        return ['具胞器細胞', '內共生帶來新的能量工廠。'];

    if (state.achievements.includes('cell'))
        return ['原始細胞', '已經具備可演化的細胞系統。'];

    return [
        'DNA',
        'DNA 本身不是細胞；探勘海洋並讓 AI 協助規劃下一步。'
    ];
}

function render() {
    const [name, hint] = status();

    $('#lifeState').textContent = name;
    $('#stateHint').textContent = hint;
    $('#statusOrb span').textContent =
        name === 'DNA' ? 'DNA' : 'CELL';

    const inv = $('#inventory');
    inv.innerHTML = '';

    Object.entries(state.inventory)
        .sort()
        .forEach(([name, n]) => {
            const b = document.createElement('button');

            b.className =
                'material ' +
                (selected === name ? 'selected' : '');

            b.innerHTML = `${name}<b>×${n}</b>`;

            b.onclick = () => {
                selected =
                    selected === name ? null : name;

                render();
            };

            inv.append(b);
        });

    $('#inventoryCount').textContent =
        `${Object.keys(state.inventory).length} 種物質`;

    $('#selectionText').textContent =
        selected
            ? `已選：${selected}`
            : '尚未選擇物質';

    const bench = $('#workbench');
    bench.innerHTML = '';

    state.board.forEach((item, i) => {
        const el = document.createElement('button');

        el.className =
            'cell ' + (item ? 'filled' : '');

        el.textContent = item || '+';

        el.onclick = () => place(i);

        bench.append(el);
    });

    renderAchievements();
    save();
}

function renderAchievements() {
    const list = $('#achievements');

    if (!list) return;

    const defs = [
        ['membrane', '膜的起源', '建立界線與內外環境'],
        ['molecule', '分子組裝', '產生可用的生物分子'],
        ['cell', '細胞化', '形成原始細胞系統'],
        ['organelle', '內共生', '取得胞器'],
        ['division', '生命延續', '完成第一次細胞分裂']
    ];

    list.innerHTML = defs
        .map(([id, title, desc]) => `
            <div class="achievement ${
                state.achievements.includes(id)
                    ? 'unlocked'
                    : ''
            }">
                <span>
                    ${
                        state.achievements.includes(id)
                            ? '✓'
                            : '○'
                    }
                </span>

                <div>
                    <b>${title}</b>
                    <small>${desc}</small>
                </div>
            </div>
        `)
        .join('');
}

function notify(text) {
    $('#reactionLog').textContent = text;
}

function place(i) {
    if (state.board[i]) {
        add(state.board[i]);
        state.board[i] = null;
        render();
        return;
    }

    if (!selected || !state.inventory[selected])
        return;

    if (--state.inventory[selected] === 0)
        delete state.inventory[selected];

    state.board[i] = selected;

    render();
}

function receive(item) {
    add(item);

    const d = document.createElement('div');

    d.className = 'incoming-item';
    d.textContent = `+ ${item}`;

    $('#incoming').append(d);

    setTimeout(() => d.remove(), 1400);

    render();
}

function startDrops() {
    if (timer) return;

    let left = 10;

    $('#nextDrop').textContent =
        `下一批物資：${left} 秒`;

    timer = setInterval(() => {
        left--;

        $('#nextDrop').textContent =
            `下一批物資：${left} 秒`;

        if (left === 0) {
            receive(
                oceanDrops[
                    Math.floor(
                        Math.random() *
                        oceanDrops.length
                    )
                ]
            );

            left = 10;
        }
    }, 1000);
}

function explore() {
    const b = $('#exploreButton');

    b.disabled = true;

    setTimeout(() => {

        if (
            !state.achievements.includes(
                'first-exploration'
            )
        ) {
            add('磷脂質', 2);

            achievement(
                'first-exploration',
                '海洋探勘'
            );

            notify(
                '發現磷脂質。把材料放上合成台，讓 AI 判斷可行的演化途徑。'
            );

            startDrops();

        } else {

            receive(
                oceanDrops[
                    Math.floor(
                        Math.random() *
                        oceanDrops.length
                    )
                ]
            );

            notify(
                '探勘隊帶回一份原始海洋材料。'
            );
        }

        b.disabled = false;

        render();

    }, 650);
}


/* =========================
   AI 設定
========================= */

function getAIConfig() {
    try {
        return JSON.parse(
            localStorage.getItem(apiStorageKey) || '{}'
        );
    } catch {
        return {};
    }
}


/* =========================
   AI Prompt
========================= */

function buildPrompt(items) {

    return `
你是「細胞工廠」的生物學導引員。

玩家目前生命階段：
${status()[0]}

已解鎖：
${state.achievements.join('、') || '無'}

目前合成台材料：
${items.join('、')}

請依照真實生物學判斷最佳的下一步。

規則：

1. 不可以把不可能的化學反應判定為成功。
2. 可以提出化學／生化組裝。
3. 可以發現新的生物分子。
4. 可以形成膜。
5. 可以形成原始細胞。
6. 粒線體等胞器必須透過吞噬與長期內共生形成。
7. 不可以把粒線體當成普通化合物直接合成。
8. 可以發生細胞分裂。
9. 如果材料不足，verdict 必須是 partial。
10. partial 時不要消耗玩家材料。
11. partial 時請告訴玩家還需要什麼材料。
12. 遊戲應該逐步從分子 → 膜 → 原始細胞 → 內共生 → 複雜細胞發展。

只回傳 JSON。

格式：

{
    "verdict": "success|partial",
    "mode": "molecule|membrane|cell|endosymbiosis|division|discovery",
    "product": "產物或事件名稱",
    "explanation": "繁體中文、55字內",
    "keep_host": true,
    "needed": "可選，缺少的條件"
}
`;
}


/* =========================
   Gemini API
========================= */

async function askGemini(config, prompt) {

    const model =
        (config.model || 'gemini-2.5-flash')
        .trim()
        .replace(/^models\//, '');

    // 永遠依照目前模型重新建立 Gemini 官方 Endpoint
    // 避免 localStorage 裡殘留舊的 404 Endpoint
    const url =
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

    const response = await fetch(url, {

        method: 'POST',

        headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': config.key
        },

        body: JSON.stringify({

            systemInstruction: {
                parts: [
                    {
                        text:
                            '你是嚴謹的生物學遊戲導引員。只輸出有效 JSON，不要 Markdown。'
                    }
                ]
            },

            contents: [
                {
                    role: 'user',

                    parts: [
                        {
                            text: prompt
                        }
                    ]
                }
            ],

            generationConfig: {
                temperature: 0.35,
                responseMimeType: 'application/json'
            }

        })
    });

    if (!response.ok) {

        let detail = '';

        try {
            const errorData =
                await response.json();

            detail =
                errorData.error?.message || '';
        } catch {}

        throw new Error(
            `Gemini API 回應失敗（${response.status}）` +
            (detail ? `：${detail}` : '')
        );
    }

    const data =
        await response.json();

    const text =
        data.candidates?.[0]?.content?.parts
            ?.map(part => part.text || '')
            .join('') || '';

    if (!text) {
        throw new Error(
            'Gemini 沒有回傳有效內容'
        );
    }

    try {

        return JSON.parse(text);

    } catch {

        throw new Error(
            'Gemini 回傳內容不是有效 JSON'
        );
    }
}


/* =========================
   OpenAI API
========================= */

async function askOpenAI(config, prompt) {

    const endpoint =
        config.endpoint ||
        'https://api.openai.com/v1/chat/completions';

    const response = await fetch(endpoint, {

        method: 'POST',

        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.key}`
        },

        body: JSON.stringify({

            model:
                config.model ||
                'gpt-4.1-mini',

            messages: [

                {
                    role: 'system',

                    content:
                        '只輸出有效 JSON。嚴格遵守使用者訊息中的生物學限制。'
                },

                {
                    role: 'user',

                    content: prompt
                }

            ],

            temperature: 0.35,

            response_format: {
                type: 'json_object'
            }
        })
    });

    if (!response.ok) {

        throw new Error(
            `OpenAI API 回應失敗（${response.status}）`
        );
    }

    const data =
        await response.json();

    const text =
        data.choices?.[0]?.message?.content;

    if (!text) {
        throw new Error(
            'OpenAI 沒有回傳有效內容'
        );
    }

    try {
        return JSON.parse(text);
    } catch {
        throw new Error(
            'OpenAI 回傳的內容不是有效 JSON'
        );
    }
}


/* =========================
   統一 AI 入口
========================= */

async function askAI(items) {

    const config = getAIConfig();

    if (!config.provider) {
        throw new Error(
            '尚未選擇 AI 供應商'
        );
    }

    if (!config.key) {
        throw new Error(
            '尚未設定 API Key'
        );
    }

    const prompt =
        buildPrompt(items);

    if (config.provider === 'gemini') {

        return await askGemini(
            config,
            prompt
        );

    }

    if (config.provider === 'openai') {

        return await askOpenAI(
            config,
            prompt
        );

    }

    throw new Error(
        '未知的 AI 供應商'
    );
}


/* =========================
   成就
========================= */

function unlockFrom(result) {

    if (result.mode === 'membrane')
        achievement(
            'membrane',
            '膜的起源'
        );

    if (
        ['molecule', 'discovery']
            .includes(result.mode)
    )
        achievement(
            'molecule',
            '分子組裝'
        );

    if (result.mode === 'cell')
        achievement(
            'cell',
            '細胞化'
        );

    if (
        result.mode ===
        'endosymbiosis'
    )
        achievement(
            'organelle',
            '內共生'
        );

    if (result.mode === 'division')
        achievement(
            'division',
            '生命延續'
        );
}


/* =========================
   合成
========================= */

async function synthesize() {

    const items =
        state.board.filter(Boolean);

    if (!items.length) {

        return notify(
            '請先將材料放到合成台。'
        );
    }

    const btn =
        $('#synthesizeButton');

    btn.disabled = true;

    notify(
        'AI 正在檢視反應條件、演化機制與材料限制……'
    );

    await new Promise(
        resolve => setTimeout(resolve, 700)
    );

    try {

        const result =
            await askAI(items);

        if (result.verdict !== 'success') {

            notify(
                `條件尚不足：${result.explanation}` +
                (
                    result.needed
                        ? ` 建議探勘：${result.needed}。`
                        : ''
                ) +
                ' 原料已保留。'
            );

            btn.disabled = false;

            return;
        }

        state.board =
            Array(25).fill(null);

        if (result.product) {
            add(result.product);
        }

        if (
            result.keep_host &&
            items.includes('原始細胞')
        ) {
            add('原始細胞');
        }

        unlockFrom(result);

        notify(
            `${
                result.mode === 'endosymbiosis'
                    ? '內共生事件'
                    : 'AI 判定成功'
            }：${result.product}。${result.explanation}`
        );

    } catch (error) {

        notify(
            `${error.message}。請點右上角 AI 確認設定；材料已保留。`
        );
    }

    btn.disabled = false;

    render();
}


/* =========================
   UI
========================= */

$('#exploreButton').onclick =
    explore;

$('#clearButton').onclick = () => {

    state.board
        .filter(Boolean)
        .forEach(x => add(x));

    state.board =
        Array(25).fill(null);

    render();
};

$('#synthesizeButton').onclick =
    synthesize;

$('#resetButton').onclick = () => {

    if (
        confirm(
            '要重新開始這座細胞工廠嗎？'
        )
    ) {

        localStorage.removeItem(
            storageKey
        );

        location.reload();
    }
};


/* =========================
   AI 設定視窗
========================= */

$('#apiButton').onclick = () => {

    const config =
        getAIConfig();

    const provider =
        config.provider || 'gemini';

    $('#apiProvider').value =
        provider;

    $('#apiKey').value =
        config.key || '';

    $('#apiModel').value =
        config.model ||
        (
            provider === 'gemini'
                ? 'gemini-2.5-flash'
                : 'gpt-4.1-mini'
        );

    $('#apiEndpoint').value =
        config.endpoint || '';

    updateAPIUI();

    $('#apiDialog').showModal();
};


/* =========================
   API UI
========================= */

function updateAPIUI() {

    const provider =
        $('#apiProvider').value;

    const isGemini =
        provider === 'gemini';

    $('#apiModel').value =
        getAIConfig().provider === provider &&
        getAIConfig().model
            ? getAIConfig().model
            : (
                isGemini
                    ? 'gemini-2.5-flash'
                    : 'gpt-4.1-mini'
            );

    $('#apiEndpoint').placeholder =
        isGemini
            ? '可留空，使用 Gemini 官方 API'
            : 'https://api.openai.com/v1/chat/completions';

    const hint =
        $('#endpointHint');

    if (hint) {

        hint.textContent =
            isGemini
                ? 'Gemini 可直接輸入 API Key，Endpoint 通常不需要修改。'
                : 'OpenAI 可使用官方 Endpoint 或其他 OpenAI 相容 API。';
    }
}

$('#apiProvider')
    .addEventListener(
        'change',
        updateAPIUI
    );


/* =========================
   儲存 API
========================= */

$('#apiForm').addEventListener(
    'submit',
    e => {

        e.preventDefault();

        const provider =
            $('#apiProvider').value;

        const key =
            $('#apiKey').value.trim();

        const model =
            $('#apiModel').value.trim();

        let endpoint =
            $('#apiEndpoint').value.trim();

        if (!key) {

            notify(
                '請先輸入 API Key。'
            );

            return;
        }

        if (
            provider === 'gemini' &&
            !endpoint
        ) {

            endpoint =
                `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
        }

        if (
            provider === 'openai' &&
            !endpoint
        ) {

            endpoint =
                'https://api.openai.com/v1/chat/completions';
        }

        localStorage.setItem(
            apiStorageKey,
            JSON.stringify({
                provider,
                key,
                model,
                endpoint
            })
        );

        $('#apiDialog').close();

        notify(
            `${
                provider === 'gemini'
                    ? 'Gemini'
                    : 'OpenAI'
            } AI 導引員已設定。`
        );
    }
);


/* =========================
   啟動
========================= */

render();

if (
    state.achievements
        .includes('first-exploration')
) {
    startDrops();
      }
