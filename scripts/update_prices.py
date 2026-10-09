"""관심 종목(data/watchlist.json)의 일봉 시세를 받아 data/prices/{kr|us}/{ticker}.json에 저장해요.

- 국내: pykrx (네이버 수정주가: 분할·병합·증자 반영, 배당은 미반영)
- 미국: yfinance (auto_adjust: 분할·배당 반영)
- 새 종목은 최근 10년치를 받아요.
- 이미 있는 종목은 최근 며칠을 겹쳐 받아 비교해요. 겹친 날 종가가 달라졌으면
  (분할·배당으로 과거 수정주가가 바뀜) 그 종목만 처음부터 다시 받고, 같으면 새 날짜만 덧붙여요.
- 한 종목이 실패해도 기존 파일은 그대로 두고 다음 종목으로 넘어가요. 실패 목록은 로그와 실행 요약에 남겨요.
- 한 시장의 종목을 하나도 못 받으면 종료 코드 1 (워크플로는 받은 것만 커밋하고 실패로 표시)

사용: python scripts/update_prices.py --market all|kr|us
"""
import argparse
import datetime as dt
import json
import math
import os
import sys
import time
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
YEARS = 10
OVERLAP = 10  # 이미 있는 종목을 겹쳐 받을 거래일 수
PAUSE = 1.0  # 종목 사이 쉬는 시간(초): 데이터 출처에 부담 덜 주게
CURRENCY = {"kr": "KRW", "us": "USD"}
ADJUST = {"kr": "split", "us": "split+dividend"}
COLS = ["date", "open", "high", "low", "close", "volume"]
LABEL = {
    "new": "🆕 새로 받음",
    "append": "➕ 덧붙임",
    "refetch": "🔄 수정주가 바뀜 → 처음부터 다시 받음",
    "same": "변경 없음",
}


# ---------- 데이터 출처: [(날짜, 시가, 고가, 저가, 종가, 거래량)] ----------
def fetch_kr(ticker, start, end):
    from pykrx import stock

    # adjusted=True(기본): 네이버 수정주가 경로라 KRX 로그인 필요 없음
    df = stock.get_market_ohlcv(start.strftime("%Y%m%d"), end.strftime("%Y%m%d"), ticker)
    return [(d.date().isoformat(), r["시가"], r["고가"], r["저가"], r["종가"], r["거래량"]) for d, r in df.iterrows()]


def fetch_us(ticker, start, end):
    import yfinance as yf

    df = yf.Ticker(ticker).history(
        start=start.isoformat(),
        end=(end + dt.timedelta(days=1)).isoformat(),  # end는 그날을 빼므로 하루 더
        auto_adjust=True,
        actions=False,
        raise_errors=True,
    )
    return [(d.date().isoformat(), r["Open"], r["High"], r["Low"], r["Close"], r["Volume"]) for d, r in df.iterrows()]


FETCH = {"kr": fetch_kr, "us": fetch_us}


# ---------- 정리·병합 ----------
def bad(x):
    return x is None or not math.isfinite(float(x)) or float(x) <= 0


def num(x):
    v = round(float(x), 4)
    return int(v) if v.is_integer() else v


def clean(raw):
    """종가가 없는 날은 빼고, 시가·고가·저가가 0인 날(거래정지 등)은 종가로 채워요.
    엔진이 0원을 손절로 착각하지 않게."""
    rows = {}
    for d, o, h, l, c, v in raw:
        if bad(c):
            continue
        o, h, l = (c if bad(x) else x for x in (o, h, l))
        rows[d] = [d, num(o), num(h), num(l), num(c), 0 if v is None or not math.isfinite(float(v)) else int(v)]
    return [rows[d] for d in sorted(rows)]


def price_path(market, ticker):
    return DATA / "prices" / market / f"{ticker}.json"


def update_one(market, ticker, today):
    """(rows, 상태) — 상태: new / append / refetch / same"""
    def fetch(start):
        return clean(FETCH[market](ticker, start, today))

    path = price_path(market, ticker)
    old = json.loads(path.read_text("utf-8"))["rows"] if path.exists() else []
    if not old:
        rows = fetch(today - dt.timedelta(days=round(365.25 * YEARS)))
        if not rows:
            raise RuntimeError("받은 데이터가 없어요 (티커를 확인해 주세요)")
        return rows, "new"

    fresh = fetch(dt.date.fromisoformat(old[-min(OVERLAP, len(old))][0]))
    if not fresh:
        raise RuntimeError("최근 데이터가 비어 있어요")
    last = old[-1][0]
    # 마지막 저장일은 비교에서 빼요: 장중에 수동 실행해서 덜 끝난 봉이 저장됐을 수 있어서
    old_close = {r[0]: r[4] for r in old[:-1]}
    common = [r for r in fresh if r[0] in old_close]
    rewritten = (len(old) > 1 and not common) or any(
        not math.isclose(old_close[r[0]], r[4], rel_tol=1e-4, abs_tol=1e-4) for r in common
    )
    if rewritten:
        rows = fetch(dt.date.fromisoformat(old[0][0]))
        if not rows:
            raise RuntimeError("다시 받은 데이터가 비어 있어요")
        return rows, "refetch"

    merged = {r[0]: r for r in old}
    merged.update({r[0]: r for r in fresh if r[0] >= last})  # 마지막 저장일은 새 값으로 덮어씀
    rows = [merged[d] for d in sorted(merged)]
    return rows, ("same" if rows == old else "append")


# ---------- 파일 쓰기 ----------
def write_prices(market, ticker, rows):
    """한 줄에 하루씩 (GitHub에서 바뀐 날짜만 diff로 보이게)"""
    head = {"ticker": ticker, "market": market, "currency": CURRENCY[market], "adjust": ADJUST[market], "cols": COLS}
    lines = ["{"] + [f"  {json.dumps(k)}: {json.dumps(v, ensure_ascii=False)}," for k, v in head.items()]
    lines += ['  "rows": [', ",\n".join("    " + json.dumps(r, separators=(",", ":")) for r in rows), "  ]", "}"]
    path = price_path(market, ticker)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n", "utf-8")


def write_json(path, obj):
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2, sort_keys=True) + "\n", "utf-8")


def watch_tickers(watch, market):
    """벤치마크 + 관심 종목 티커 (중복 제거)"""
    section = watch.get(market) or {}
    out = []
    for item in [section.get("benchmark")] + list(section.get("stocks") or []):
        t = str((item or {}).get("ticker", "")).strip()
        if t and t not in out:
            out.append(t)
    return out


def report(results, failures):
    print("\n===== 결과 =====")
    for status, label in LABEL.items():
        n = sum(1 for s in results.values() if s == status)
        if n:
            print(f"{label}: {n}종목")
    if failures:
        print(f"❌ 실패: {len(failures)}종목")
        for m, t, why in failures:
            print(f"  - [{m}] {t}: {why}")
            print(f"::warning title=시세 받기 실패 [{m}] {t}::{why}")
    else:
        print("❌ 실패: 없음")

    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if not summary:
        return
    md = ["## 시세 업데이트", "", "| 결과 | 종목 수 |", "|---|---|"]
    md += [f"| {label} | {sum(1 for s in results.values() if s == st)} |" for st, label in LABEL.items()]
    md += [f"| ❌ 실패 | {len(failures)} |", ""]
    if failures:
        md += ["### ❌ 실패 목록 (기존 데이터는 그대로 뒀어요)", "", "| 시장 | 종목 | 이유 |", "|---|---|---|"]
        md += [f"| {m} | {t} | {why.replace('|', '/')} |" for m, t, why in failures]
    with open(summary, "a", encoding="utf-8") as f:
        f.write("\n".join(md) + "\n")


def main():
    ap = argparse.ArgumentParser(description="관심 종목 일봉 시세 받기")
    ap.add_argument("--market", choices=["all", "kr", "us"], default="all")
    market = ap.parse_args().market
    markets = ["kr", "us"] if market == "all" else [market]

    try:
        watch = json.loads((DATA / "watchlist.json").read_text("utf-8"))
    except json.JSONDecodeError as e:
        print(f"::error title=watchlist.json 형식 오류::{e.lineno}번째 줄 근처를 확인해 주세요 ({e.msg})")
        return 1
    meta_path = DATA / "meta.json"
    meta = json.loads(meta_path.read_text("utf-8")) if meta_path.exists() else {}
    today = dt.datetime.now(ZoneInfo("Asia/Seoul")).date()

    results, failures, broken = {}, [], []
    for m in markets:
        tickers = watch_tickers(watch, m)
        ok = 0
        for t in tickers:
            try:
                rows, status = update_one(m, t, today)
                if status != "same":
                    write_prices(m, t, rows)
                meta.setdefault(m, {})[t] = {"first": rows[0][0], "last": rows[-1][0]}
                results[(m, t)] = status
                ok += 1
                print(f"[{m}] {t}: {LABEL[status]} ({rows[-1][0]}까지 {len(rows)}일)", flush=True)
            except Exception as e:  # 한 종목 실패가 나머지를 막지 않게
                failures.append((m, t, f"{type(e).__name__}: {e}"))
                print(f"[{m}] {t}: ❌ 실패 — {type(e).__name__}: {e}", flush=True)
            time.sleep(PAUSE)
        if tickers and not ok:
            broken.append(m)

    write_json(meta_path, meta)
    report(results, failures)
    if broken:
        print(f"::error title=시장 전체 실패::{', '.join(broken)} 종목을 하나도 못 받았어요. 데이터 출처(pykrx/yfinance)가 바뀌었을 수 있어요.")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
