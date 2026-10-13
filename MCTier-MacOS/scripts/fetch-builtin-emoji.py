#!/usr/bin/env python3
"""Fetch and pack the pinned built-in emoji set for offline client builds."""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import re
import struct
import subprocess
import shutil
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.request import ProxyHandler, Request, build_opener

SOURCE_PAGE = "https://www.emojiall.com/zh-hans/image-emoji-platform/telegram/animation"
ASSET_ROOT = "https://www.emojiall.com/images/120/telegram"
PATTERN = re.compile(r"/images/120/telegram/([A-Za-z0-9_-]+)\.gif")
MAGIC = b"MCTIER_EMOJI_PACK_V3\0"
MAX_PAGE_BYTES = 2 * 1024 * 1024
MAX_GIF_BYTES = 4 * 1024 * 1024
MIN_COUNT = 100
MAX_COUNT = 2000

def read_url(opener, url: str, limit: int, attempts: int = 6) -> bytes:
    last_error: Exception | None = None
    for attempt in range(attempts):
        try:
            request = Request(url, headers={"User-Agent": "MCTier/3.5 offline-emoji-builder"})
            with opener.open(request, timeout=60) as response:
                data = response.read(limit + 1)
            if len(data) > limit:
                raise ValueError(f"resource exceeds {limit} bytes: {url}")
            return data
        except Exception as error:
            last_error = error
            if attempt + 1 < attempts:
                time.sleep(min(16, 2 ** attempt))
    assert last_error is not None
    raise last_error

def gif_ok(data: bytes) -> bool:
    return len(data) >= 6 and data[:6] in (b"GIF87a", b"GIF89a")

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--proxy", default="")
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--cache", type=Path, default=Path(".emoji-build"))
    args = parser.parse_args()
    proxy = ProxyHandler({"http": args.proxy, "https": args.proxy}) if args.proxy else ProxyHandler({})
    opener = build_opener(proxy)
    args.cache.mkdir(parents=True, exist_ok=True)
    page_cache = args.cache / "source.html"
    if page_cache.is_file() and 0 < page_cache.stat().st_size <= MAX_PAGE_BYTES:
        html_bytes = page_cache.read_bytes()
    else:
        html_bytes = read_url(opener, SOURCE_PAGE, MAX_PAGE_BYTES)
        page_cache.with_suffix(".part").write_bytes(html_bytes)
        page_cache.with_suffix(".part").replace(page_cache)
    html = html_bytes.decode("utf-8")
    # This source's 1f60d animation duplicates 1f970.
    ids = [emoji_id for emoji_id in dict.fromkeys(PATTERN.findall(html)) if emoji_id != "1f60d"]
    if not MIN_COUNT <= len(ids) <= MAX_COUNT:
        raise ValueError(f"unexpected emoji count: {len(ids)}")
    (args.cache / "ids.txt").write_text("\n".join(ids) + "\n", encoding="ascii")
    asset_cache = args.cache / "assets"
    asset_cache.mkdir(exist_ok=True)

    def fetch(item: tuple[int, str]) -> tuple[int, str, bytes]:
        index, emoji_id = item
        cached = asset_cache / f"{emoji_id}.gif"
        data = cached.read_bytes() if cached.is_file() and cached.stat().st_size <= MAX_GIF_BYTES else b""
        if not gif_ok(data):
            data = read_url(opener, f"{ASSET_ROOT}/{emoji_id}.gif", MAX_GIF_BYTES)
            temporary_asset = asset_cache / f"{emoji_id}.part"
            temporary_asset.write_bytes(data)
            temporary_asset.replace(cached)
        if not gif_ok(data):
            raise ValueError(f"invalid GIF: {emoji_id}")
        return index, emoji_id, data

    fetched: list[tuple[str, bytes] | None] = [None] * len(ids)
    with ThreadPoolExecutor(max_workers=max(1, args.workers)) as pool:
        futures = [pool.submit(fetch, item) for item in enumerate(ids)]
        for future in as_completed(futures):
            index, emoji_id, data = future.result()
            fetched[index] = (emoji_id, data)
            print(f"{index + 1}/{len(ids)} {emoji_id} {len(data)} bytes", flush=True)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output.with_suffix(args.output.suffix + ".tmp")
    digest = hashlib.sha256()
    with temporary.open("wb") as raw_file:
        with gzip.GzipFile(fileobj=raw_file, mode="wb", compresslevel=9, mtime=0) as packed:
            packed.write(MAGIC)
            packed.write(struct.pack("<I", len(ids)))
            for item in fetched:
                assert item is not None
                emoji_id, data = item
                name = emoji_id.encode("ascii")
                packed.write(struct.pack("<HI", len(name), len(data)))
                packed.write(name)
                packed.write(data)
                digest.update(data)
    temporary.replace(args.output)
    manifest = {
        "version": 3,
        "format": "gif",
        "count": len(ids),
        "source": SOURCE_PAGE,
        "pack": args.output.name,
        "sourceGifBytes": sum(len(item[1]) for item in fetched if item),
        "rawBytes": sum(len(item[1]) for item in fetched if item),
        "packBytes": args.output.stat().st_size,
        "sha256": digest.hexdigest(),
        "ids": ids,
    }
    args.manifest.parent.mkdir(parents=True, exist_ok=True)
    args.manifest.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: manifest[k] for k in ("count", "rawBytes", "packBytes", "sha256")}, ensure_ascii=False))
    return 0

if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"error: {error}", file=sys.stderr)
        raise
