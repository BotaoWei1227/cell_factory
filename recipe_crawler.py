#!/usr/bin/env python3
"""遞迴查詢《無限煉製》配方，並選出最短的合成樹。

只讀取遊戲公開 API，不會登入、送出合成或修改任何遊戲資料。
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen


API_ROOT = "https://pillars-of-creation.funtuan.work/api/nodes"


@dataclass(frozen=True)
class Recipe:
    left: str
    right: str
    left_emoji: str = ""
    right_emoji: str = ""


@dataclass
class Node:
    word: str
    emoji: str = ""
    recipes: list[Recipe] | None = None
    error: str | None = None


@dataclass
class Plan:
    word: str
    emoji: str
    recipe: Recipe | None
    children: list["Plan"]
    height: int
    leaves: int
    state: str  # owned / unavailable / depth-limit / cycle / recipe


class RecipeCrawler:
    def __init__(self, timeout: float, pause: float, workers: int) -> None:
        self.timeout = timeout
        self.pause = pause
        self.workers = workers
        self.cache: dict[str, Node] = {}

    def fetch(self, word: str) -> Node:
        """取得一個詞的公開配方；所有結果均快取以避免重複請求。"""
        if word in self.cache:
            return self.cache[word]

        base_url = f"{API_ROOT}/{quote(word, safe='')}"

        def get_json(url: str) -> dict[str, Any]:
            request = Request(url, headers={"User-Agent": "recipe-tree-crawler/1.0"})
            with urlopen(request, timeout=self.timeout) as response:
                return json.load(response)

        try:
            # /recipes 是頁面「查看更多配方」的清單；/nodes/{word} 額外含
            # 代表性舊配方。合併兩者，才能避免只因時間排序而漏掉捷徑。
            detail = get_json(base_url).get("node", {})
            listing = get_json(f"{base_url}/recipes")
            raw_recipes = [*listing.get("recipes", []), *detail.get("recipes", [])]
            seen: set[tuple[str, str]] = set()
            recipes: list[Recipe] = []
            for item in raw_recipes:
                if not item.get("a") or not item.get("b"):
                    continue
                pair = (item["a"], item["b"])
                if pair in seen:
                    continue
                seen.add(pair)
                recipes.append(
                    Recipe(
                        left=item["a"],
                        right=item["b"],
                        left_emoji=item.get("aEmoji", ""),
                        right_emoji=item.get("bEmoji", ""),
                    )
                )
            node = Node(word=word, emoji=detail.get("emoji", ""), recipes=recipes)
        except HTTPError as exc:
            node = Node(word=word, recipes=[], error=f"HTTP {exc.code}")
        except (URLError, TimeoutError, json.JSONDecodeError) as exc:
            node = Node(word=word, recipes=[], error=str(exc))
        self.cache[word] = node
        if self.pause:
            time.sleep(self.pause)
        return node

    def crawl(self, target: str, max_depth: int, max_nodes: int) -> None:
        """由目標往原料展開。上限防止熱門詞的分支無限制膨脹。"""
        frontier = {target}
        seen: set[str] = set()
        for _ in range(max_depth + 1):
            batch = [word for word in frontier if word not in seen]
            if not batch or len(seen) >= max_nodes:
                return
            batch = batch[: max_nodes - len(seen)]
            seen.update(batch)
            with ThreadPoolExecutor(max_workers=self.workers) as pool:
                futures = {pool.submit(self.fetch, word): word for word in batch}
                for future in as_completed(futures):
                    future.result()
            next_frontier: set[str] = set()
            for word in batch:
                for recipe in self.cache[word].recipes or []:
                    next_frontier.update((recipe.left, recipe.right))
            frontier = next_frontier

    def shortest_plan(self, target: str, owned: set[str], max_depth: int) -> Plan:
        """找最短合成樹。

        排序準則是：最少合成層數、最少原料葉節點、最少總節點。
        這比只挑第一條配方可靠，也會同時處理一條配方的兩個原料。
        """
        memo: dict[tuple[str, int, tuple[str, ...]], Plan] = {}

        def solve(word: str, remaining: int, trail: tuple[str, ...]) -> Plan:
            key = (word, remaining, trail)
            if key in memo:
                return memo[key]
            node = self.cache.get(word) or self.fetch(word)
            if word in owned:
                result = Plan(word, node.emoji, None, [], 0, 1, "owned")
            elif word in trail:
                result = Plan(word, node.emoji, None, [], 0, 1, "cycle")
            elif remaining == 0:
                result = Plan(word, node.emoji, None, [], 0, 1, "depth-limit")
            elif not node.recipes:
                result = Plan(word, node.emoji, None, [], 0, 1, "unavailable")
            else:
                options: list[Plan] = []
                for recipe in node.recipes:
                    left = solve(recipe.left, remaining - 1, trail + (word,))
                    right = solve(recipe.right, remaining - 1, trail + (word,))
                    options.append(
                        Plan(
                            word,
                            node.emoji,
                            recipe,
                            [left, right],
                            1 + max(left.height, right.height),
                            left.leaves + right.leaves,
                            "recipe",
                        )
                    )
                result = min(
                    options,
                    key=lambda plan: (
                        plan.height,
                        unresolved_leaves(plan),
                        plan.leaves,
                        tree_size(plan),
                    ),
                )
            memo[key] = result
            return result

        return solve(target, max_depth, ())


def tree_size(plan: Plan) -> int:
    return 1 + sum(tree_size(child) for child in plan.children)


def unresolved_leaves(plan: Plan) -> int:
    """已有材料不應和未知材料在同一條件下打平。"""
    if not plan.children:
        return 0 if plan.state == "owned" else 1
    return sum(unresolved_leaves(child) for child in plan.children)


def render_tree(plan: Plan, prefix: str = "", is_last: bool = True) -> list[str]:
    label = f"{plan.emoji} {plan.word}".strip()
    if plan.state != "recipe":
        descriptions = {
            "owned": "已有",
            "unavailable": "找不到公開配方",
            "depth-limit": "到達深度上限",
            "cycle": "略過循環",
        }
        label += f"  [{descriptions[plan.state]}]"
    lines = [prefix + ("└─ " if is_last else "├─ ") + label]
    child_prefix = prefix + ("   " if is_last else "│  ")
    for index, child in enumerate(plan.children):
        lines.extend(render_tree(child, child_prefix, index == len(plan.children) - 1))
    return lines


def plan_to_dict(plan: Plan) -> dict[str, Any]:
    return {
        "word": plan.word,
        "emoji": plan.emoji,
        "state": plan.state,
        "height": plan.height,
        "leaves": plan.leaves,
        "recipe": asdict(plan.recipe) if plan.recipe else None,
        "ingredients": [plan_to_dict(child) for child in plan.children],
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="遞迴查詢無限煉製配方，輸出最短合成樹。")
    parser.add_argument("target", help="要製作的造物，例如：機器人")
    parser.add_argument("--owned", nargs="*", default=[], metavar="物品", help="使用者已持有的原料；這些會作為樹的終點")
    parser.add_argument("--max-depth", type=int, default=5, help="最多往上追溯幾層（預設：5）")
    parser.add_argument("--max-nodes", type=int, default=300, help="最多爬取幾個詞，避免熱門詞爆量（預設：300）")
    parser.add_argument("--workers", type=int, default=4, help="同時請求數（預設：4）")
    parser.add_argument("--pause", type=float, default=0.05, help="每次 API 請求後的等待秒數（預設：0.05）")
    parser.add_argument("--output", type=Path, default=Path("output"), help="輸出資料夾（預設：output）")
    return parser.parse_args()


def main() -> int:
    # 部分 Windows 終端仍使用 cp950，無法直接印出所有 emoji；輸出檔仍為 UTF-8。
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(errors="replace")
    args = parse_args()
    if args.max_depth < 1 or args.max_nodes < 1 or args.workers < 1:
        raise SystemExit("--max-depth、--max-nodes、--workers 都必須大於 0")

    crawler = RecipeCrawler(timeout=12, pause=args.pause, workers=args.workers)
    print(f"正在爬取「{args.target}」的配方樹…")
    crawler.crawl(args.target, args.max_depth, args.max_nodes)
    plan = crawler.shortest_plan(args.target, set(args.owned), args.max_depth)

    args.output.mkdir(parents=True, exist_ok=True)
    safe_name = args.target.replace("/", "_").replace("\\", "_")
    tree_text = "\n".join(render_tree(plan))
    summary = (
        f"目標：{args.target}\n"
        f"已爬取：{len(crawler.cache)} 個造物\n"
        f"最短合成高度：{plan.height} 層\n"
        f"原料葉節點：{plan.leaves} 個\n\n"
        f"最短合成樹\n{tree_text}\n"
    )
    text_path = args.output / f"{safe_name}-shortest-tree.txt"
    json_path = args.output / f"{safe_name}-shortest-tree.json"
    text_path.write_text(summary, encoding="utf-8")
    json_path.write_text(
        json.dumps(
            {
                "target": args.target,
                "crawl_settings": {"max_depth": args.max_depth, "max_nodes": args.max_nodes},
                "crawled_nodes": len(crawler.cache),
                "shortest_plan": plan_to_dict(plan),
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(summary)
    print(f"文字樹：{text_path}\nJSON：{json_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
