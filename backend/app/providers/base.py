"""HTTP 基座 + Provider 健康登记（主备路由）"""
from __future__ import annotations

import json
import re
import threading
import time
from dataclasses import dataclass
from typing import Any

import requests

from .. import config, db

_tls = threading.local()

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36")


def session() -> requests.Session:
    s = getattr(_tls, "s", None)
    if s is None:
        s = requests.Session()
        s.headers.update({"User-Agent": UA, "Accept": "*/*", "Connection": "close"})
        _tls.s = s
    return s


class ProviderError(RuntimeError):
    def __init__(self, provider: str, capability: str, message: str, http_status: int = 0):
        super().__init__(f"[{provider}/{capability}] {message}")
        self.provider, self.capability, self.message, self.http_status = provider, capability, message, http_status


def fetch(url: str, *, provider: str, capability: str, referer: str | None = None,
          encoding: str | None = None, params: dict | None = None,
          timeout: float | None = None, retries: int = 2, expect_json: bool = True) -> Any:
    """带重试的取数；失败抛 ProviderError，同时写入健康表"""
    headers = {"Referer": referer} if referer else {}
    last_err = "unknown"
    status_code = 0
    started = time.perf_counter()
    for attempt in range(retries + 1):
        try:
            r = session().get(url, headers=headers, params=params,
                              timeout=timeout or config.API_TIMEOUT)
            status_code = r.status_code
            if r.status_code >= 400:
                last_err = f"HTTP {r.status_code}"
            else:
                if encoding:
                    r.encoding = encoding
                raw = r.text
                if expect_json:
                    return record_ok(provider, capability, _jsonw(raw), started)
                return record_ok(provider, capability, raw, started)
        except Exception as exc:  # noqa: BLE001
            last_err = f"{type(exc).__name__}: {exc}"
        if attempt < retries:
            time.sleep(0.35 * (attempt + 1))
    record_fail(provider, capability, last_err, status_code, started)
    raise ProviderError(provider, capability, last_err, status_code)


def post_json(url: str, *, provider: str, capability: str, body: dict,
              referer: str | None = None, params: dict | None = None,
              timeout: float | None = None, retries: int = 1) -> Any:
    """少数接口只收 JSON POST（东财人气榜）"""
    headers = {"Referer": referer, "Content-Type": "application/json"} if referer \
        else {"Content-Type": "application/json"}
    last_err = "unknown"
    started = time.perf_counter()
    for attempt in range(retries + 1):
        try:
            r = session().post(url, headers=headers, json=body, params=params,
                               timeout=timeout or config.API_TIMEOUT)
            if r.status_code < 400:
                return record_ok(provider, capability, r.json(), started)
            last_err = f"HTTP {r.status_code}"
        except Exception as exc:  # noqa: BLE001
            last_err = f"{type(exc).__name__}: {exc}"
        if attempt < retries:
            time.sleep(0.3)
    record_fail(provider, capability, last_err, 0, started)
    raise ProviderError(provider, capability, last_err)


def _jsonw(raw: str) -> Any:
    raw = raw.strip()
    if raw.startswith("var "):
        m = re.match(r"^var\s+[\w.]+\s*=\s*(.+?);?\s*$", raw, re.S)
        if m:
            raw = m.group(1)
    else:
        m = re.match(r"^[\w.]+\((.*)\)\s*;?\s*$", raw, re.S)
        if m:
            raw = m.group(1)
    return json.loads(raw)


def record_ok(provider: str, capability: str, value: Any, started: float) -> Any:
    _health(provider, capability, ok=True, latency=(time.perf_counter() - started) * 1000)
    return value


def record_fail(provider: str, capability: str, err: str, http_status: int, started: float) -> None:
    _health(provider, capability, ok=False, latency=(time.perf_counter() - started) * 1000,
            error=err, http_status=http_status)


def _health(provider: str, capability: str, *, ok: bool, latency: float,
            error: str | None = None, http_status: int = 0) -> None:
    try:
        db.execute(
            "INSERT INTO provider_health(provider,capability,ok,latency_ms,http_status,error,checked_at,hits,fails) "
            "VALUES(?,?,?,?,?,?,?,?,1) "
            "ON CONFLICT(provider,capability) DO UPDATE SET "
            "ok=excluded.ok, latency_ms=excluded.latency_ms, http_status=excluded.http_status, "
            "error=excluded.error, checked_at=excluded.checked_at, "
            "hits=provider_health.hits+CASE WHEN excluded.ok=1 THEN 1 ELSE 0 END, "
            "fails=provider_health.fails+CASE WHEN excluded.ok=0 THEN 1 ELSE 0 END",
            (provider, capability, 1 if ok else 0, round(latency, 1), http_status, error, db.now(), 1 if ok else 0),
        )
    except Exception:  # noqa: BLE001
        pass


def provider_enabled(provider: str) -> bool:
    cfg = db.get_setting("data_sources", {}) or {}
    item = cfg.get(provider)
    return True if item is None else bool(item.get("enabled", True))


def call_chain(capability: str, chain: list[tuple[str, Any]]) -> Any:
    """按优先级依次尝试 [(provider, fn), ...]，主源失败自动切换备源"""
    errors = []
    for provider, fn in chain:
        if not provider_enabled(provider):
            errors.append(f"{provider}: 已被手动停用")
            continue
        try:
            return fn()
        except ProviderError as exc:
            errors.append(str(exc))
        except Exception as exc:  # noqa: BLE001
            errors.append(f"[{provider}] {type(exc).__name__}: {exc}")
    raise ProviderError("router", capability, "所有数据源均失败 -> " + " | ".join(errors))


def norm_symbol(code_or_symbol: str) -> dict:
    """600519 -> sh600519；支持 sh/sz/bj 前缀；返回 sina 符号 + 东财 secid"""
    s = str(code_or_symbol).strip().lower()
    m = re.match(r"^(sh|sz|bj)\d{6}$", s)
    if m:
        prefix, code = m.group(1), s[2:]
    elif re.match(r"^\d{6}$", s):
        code = s
        prefix = "sh" if code[0] in "569" else ("bj" if code[0] in "48" else "sz")
    elif re.match(r"^\d{5}$", s):
        # 港美股简码本轮不支持
        prefix, code = "hk", s
    else:
        raise ValueError(f"无法识别的代码：{code_or_symbol}")
    market_num = 1 if prefix == "sh" else 0
    return {"symbol": f"{prefix}{code}", "code": code, "prefix": prefix,
            "secid": f"{market_num}.{code}" if prefix != "hk" else f"116.{code}"}
