const storageKey = 'cell-factory-biology-v2';
const oceanDrops = ['磷脂質','脂肪酸','磷酸鹽','核苷酸','胺基酸','ATP','葡萄糖','氧氣','好氧細菌'];
const recipes = [
  { needs:{'磷脂質':2}, product:'脂雙層膜', note:'兩層磷脂質在水中自組裝成膜；這是熱力學驅動的自發過程。', key:'membrane' },
  { needs:{'胺基酸':2,'ATP':1}, product:'二肽', note:'遊戲中 ATP 提供活化能；真實細胞還需要核糖體或酵素催化。', key:'peptide' },
  { needs:{'核苷酸':2,'ATP':1}, product:'RNA 片段', note:'核苷酸聚合為 RNA；這是需要模板與催化條件的簡化模型。', key:'rna' },
  { needs:{'葡萄糖':1,'氧氣':1}, product:'ATP', note:'有氧呼吸將葡萄糖的能量轉為 ATP；以一份 ATP 表示簡化產量。', key:'respiration' },
  { needs:{'脂雙層膜':1,'RNA 片段':1}, product:'原始細胞', note:'獲得內外隔離的膜與遺傳資訊載體，形成遊戲中的原始細胞模型。', key:'protocell' },
  { needs:{'原始細胞':1,'好氧細菌':1,'氧氣':1}, product:'粒線體', note:'粒線體不是合成物：宿主吞噬好氧細菌後，歷經長期內共生演化而來。', key:'mitochondrion' },
  { needs:{'原始細胞':1,'ATP':1}, product:'子細胞', note:'二分裂會複製遺傳物質並分隔細胞質；ATP 代表過程需要的能量。', key:'division' }
];
const initial = { inventory:{}, board:Array(25).fill(null), achievements:[] };
let state = JSON.parse(localStorage.getItem(storageKey) || 'null') || structuredClone(initial);
let selected = null, timer = null;
const $ = s => document.querySelector(s);
const count = (items, name) => items.filter(x => x === name).length;
function save(){ localStorage.setItem(storageKey, JSON.stringify(state)); }
function add(name, n=1){ state.inventory[name] = (state.inventory[name] || 0) + n; }
function achievement(id, title){ if(!state.achievements.includes(id)){state.achievements.push(id);notify(`成就解鎖：${title}`)} }
function status(){if(state.achievements.includes('division'))return ['可分裂細胞','第一次二分裂已完成。'];if(state.achievements.includes('mitochondrion'))return ['具胞器真核細胞','粒線體的內共生為複雜生命提供能量。'];if(state.achievements.includes('protocell'))return ['原始細胞','已取得膜性邊界與遺傳資訊載體。'];if(state.achievements.includes('membrane'))return ['脂雙層囊泡','已形成細胞膜的物理基礎。'];return ['DNA','DNA 本身不是細胞；先在海洋中尋找脂質與反應原料。'];}
function render(){const [name,hint]=status();$('#lifeState').textContent=name;$('#stateHint').textContent=hint;$('#statusOrb span').textContent=name==='DNA'?'DNA':'CELL';const inv=$('#inventory');inv.innerHTML='';Object.entries(state.inventory).sort().forEach(([name,n])=>{const b=document.createElement('button');b.className='material '+(selected===name?'selected':'');b.innerHTML=`${name}<b>×${n}</b>`;b.onclick=()=>{selected=selected===name?null:name;render()};inv.append(b)});$('#inventoryCount').textContent=`${Object.keys(state.inventory).length} 種物質`;$('#selectionText').textContent=selected?`已選：${selected}`:'尚未選擇物質';const bench=$('#workbench');bench.innerHTML='';state.board.forEach((item,i)=>{const el=document.createElement('button');el.className='cell '+(item?'filled':'');el.textContent=item||'+';el.onclick=()=>place(i);bench.append(el)});renderAchievements();save();}
function renderAchievements(){const list=$('#achievements');if(!list)return;const defs=[['membrane','膜的起源','組裝脂雙層膜'],['peptide','肽鍵','形成二肽'],['rna','遺傳訊息','形成 RNA 片段'],['protocell','細胞化','形成原始細胞'],['mitochondrion','內共生','獲得粒線體'],['division','生命延續','完成第一次細胞分裂']];list.innerHTML=defs.map(([id,t,d])=>`<div class="achievement ${state.achievements.includes(id)?'unlocked':''}"><span>${state.achievements.includes(id)?'✓':'○'}</span><div><b>${t}</b><small>${d}</small></div></div>`).join('')}
function notify(t){$('#reactionLog').textContent=t}
function place(i){if(state.board[i]){add(state.board[i]);state.board[i]=null;render();return}if(!selected||!state.inventory[selected])return;if(--state.inventory[selected]===0)delete state.inventory[selected];state.board[i]=selected;render()}
function receive(item){add(item);const d=document.createElement('div');d.className='incoming-item';d.textContent=`+ ${item}`;$('#incoming').append(d);setTimeout(()=>d.remove(),1400);render()}
function startDrops(){if(timer)return;let left=10;$('#nextDrop').textContent=`下一批物資：${left} 秒`;timer=setInterval(()=>{left--;$('#nextDrop').textContent=`下一批物資：${left} 秒`;if(left===0){receive(oceanDrops[Math.floor(Math.random()*oceanDrops.length)]);left=10}},1000)}
function explore(){const b=$('#exploreButton');b.disabled=true;setTimeout(()=>{if(!state.achievements.includes('first-exploration')){add('磷脂質',2);achievement('first-exploration','原始海洋的第一片膜');notify('發現磷脂質。它能形成膜，但不能讓 DNA 立即變成原核細胞。');startDrops()}else{receive(oceanDrops[Math.floor(Math.random()*oceanDrops.length)]);notify('探勘隊帶回一份可用的原始海洋原料。')}b.disabled=false;render()},650)}
function matchingRecipe(items){return recipes.find(r=>Object.entries(r.needs).every(([n,q])=>count(items,n)===q)&&items.length===Object.values(r.needs).reduce((a,b)=>a+b,0))}
async function synthesize(){const items=state.board.filter(Boolean);if(!items.length)return notify('請先將材料放到合成台。');const btn=$('#synthesizeButton');btn.disabled=true;notify('檢查反應條件、化學計量與生物學限制……');await new Promise(r=>setTimeout(r,1400));const r=matchingRecipe(items);state.board=Array(25).fill(null);if(!r){notify('反應失敗：這組材料沒有已知、可成立的遊戲反應。原料已消耗。');btn.disabled=false;render();return}add(r.product);if(r.key==='mitochondrion')add('原始細胞');if(r.key==='division')add('原始細胞',2);achievement(r.key,r.product);notify(`反應成功：${r.product}。${r.note}`);btn.disabled=false;render()}
$('#exploreButton').onclick=explore;$('#clearButton').onclick=()=>{state.board.filter(Boolean).forEach(x=>add(x));state.board=Array(25).fill(null);render()};$('#synthesizeButton').onclick=synthesize;$('#resetButton').onclick=()=>{if(confirm('要重新開始這座細胞工廠嗎？')){localStorage.removeItem(storageKey);location.reload()}};$('#apiButton').onclick=()=>$('#apiDialog').showModal();$('#apiForm').addEventListener('submit',e=>{e.preventDefault();$('#apiDialog').close()});render();if(state.achievements.includes('first-exploration'))startDrops();
