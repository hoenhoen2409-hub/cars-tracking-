"""
Append new months to data/monthly_customs_truck_imports.csv from Vietnam
Customs' monthly CBU import reports ("Thống kê tình hình nhập khẩu ô tô
nguyên chiếc các loại ... tháng M năm YYYY", customs.gov.vn pageId=442).

customs.gov.vn is a JS-rendered page; the article body comes from the
backend API GetFEItemTKHQ, keyed by tkId (sequential across all Customs
statistics posts). We scan tkIds forward from the highest one already in
the CSV and parse the "Xe ô tô vận tải" (HS 8704 transport trucks) section
of each new monthly report.

If a month has no report of its own (Customs occasionally skips one), it is
back-derived from the next month's report: China units from the exact
"(tương ứng tăng/giảm N chiếc)" delta when given, otherwise from the MoM %;
all-origin total from the MoM %. Such rows are flagged *_estimated=1 and
point source_url at the next-month report -- same convention as the
existing rows.

    python scripts/scrape_customs_trucks.py            # append new months
    python scripts/scrape_customs_trucks.py --dry-run  # print, don't write

Exit code 0 in both cases; prints what it found (or "no new months").
"""

import argparse
import csv
import html
import json
import re
import ssl
import sys
import unicodedata
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

CSV_PATH = Path(__file__).resolve().parent.parent / "data" / "monthly_customs_truck_imports.csv"
API_URL = "https://www.customs.gov.vn/bridge?url=/customs/api/GetFEItemTKHQ"
SOURCE_URL = "https://www.customs.gov.vn/index.jsp?pageId=442&tkId={}"
FIELDS = ["year", "month", "china_units", "total_units", "total_value_usd",
          "china_estimated", "total_estimated", "source_url", "note"]

TITLE_RE = re.compile(r"nhập khẩu ô tô nguyên chiếc.*?tháng\s+0?(\d{1,2})\s+năm\s+(\d{4})", re.I)
# Customs' TLS chain doesn't always verify cleanly from CI boxes.
SSL_CTX = ssl._create_unverified_context()


def vn_int(s):
    """'1.627' -> 1627 (Vietnamese thousands separator)."""
    return int(s.replace(".", ""))


def vn_float(s):
    """'-51,3' -> -51.3 (Vietnamese decimal comma)."""
    return float(s.replace(".", "").replace(",", "."))


def fetch(tk_id):
    body = json.dumps({"ma": str(tk_id), "top": "1", "chuyen_muc_id": -2,
                       "moi_cong_bo_id": -1, "language": "TIENG_VIET"}).encode()
    req = urllib.request.Request(API_URL, data=body, headers={"User-Agent": "Mozilla/5.0"})
    for _ in range(3):
        try:
            with urllib.request.urlopen(req, context=SSL_CTX, timeout=30) as resp:
                item = json.load(resp)["d"]["tinGioiThieu"]
            item = item[0] if isinstance(item, list) else item
            return tk_id, item or None
        except Exception:
            continue
    return tk_id, None


def clean_text(raw_html):
    text = html.unescape(re.sub(r"<[^>]+>", " | ", raw_html or ""))
    # The CMS mixes precomposed and combining diacritics ("chi&ecirc;́c");
    # NFC makes the Vietnamese regexes below match either way.
    text = unicodedata.normalize("NFC", text)
    text = re.sub(r"[ \t\r\n\xa0]+", " ", text)
    return re.sub(r"(\s*\|\s*)+", " | ", text)


def parse_truck_section(text):
    """Pull the transport-truck numbers out of one monthly report.

    Returns dict with total, total_mom_pct, value_usd, china, china_mom_pct,
    china_mom_delta (any may be None if the wording didn't match)."""
    out = dict(total=None, total_mom_pct=None, value_usd=None,
               china=None, china_mom_pct=None, china_mom_delta=None)

    # Anchor on the paragraph's opening sentence, not the "Xe ô tô vận tải"
    # heading -- the same words also appear earlier (table/chart captions).
    anchor = re.search(r"lượng xe ô tô (?:vận )?tải làm thủ tục", text)
    if not anchor:
        return out
    start = anchor.start()
    end = text.find("Xe ô tô loại khác", start)
    para = text[start:end if end > 0 else start + 2500]

    m = re.search(r"là\s+([\d.]+)\s+chiếc,\s+với trị giá đạt[^\d]*([\d.,]+)\s+triệu USD;\s*(tăng|giảm)[^\d]*([\d.,]+)%\s+về lượng", para)
    if m:
        out["total"] = vn_int(m.group(1))
        out["value_usd"] = round(vn_float(m.group(2)) * 1e6)
        out["total_mom_pct"] = vn_float(m.group(4)) * (1 if m.group(3) == "tăng" else -1)

    # Exact value (USD) from the summary table row, when present.
    row = re.search(r"Ô tô vận tải \| ([\d.]+) \| ([\d.]+) \|", text)
    if row and out["total"] is not None and vn_int(row.group(1)) == out["total"]:
        out["value_usd"] = vn_int(row.group(2))

    # Three phrasings: "N chiếc xe (có) xuất xứ (từ) Trung Quốc, tăng X% (tương ứng tăng D chiếc)",
    # "xe xuất xứ Trung Quốc với N chiếc, ..." and "xuất xứ từ Trung Quốc là N chiếc, ...".
    china = re.search(r"([\d.]+)\s+chiếc xe (?:có )?xuất xứ (?:từ )?Trung Quốc([^|;]*)", para)
    if not china:
        china = re.search(r"xuất xứ (?:từ )?Trung Quốc (?:với|là)\s+([\d.]+)\s+chiếc([^|;]*)", para)
    if china:
        out["china"] = vn_int(china.group(1))
        tail = china.group(2)
        pct = re.match(r"\s*,\s*(tăng|giảm)[^\d(]*([\d.,]+)%", tail)
        if pct:
            out["china_mom_pct"] = vn_float(pct.group(2)) * (1 if pct.group(1) == "tăng" else -1)
        delta = re.search(r"tương ứng (tăng|giảm)(?: tới)?\s+([\d.]+)\s+chiếc", tail)
        if delta:
            out["china_mom_delta"] = vn_int(delta.group(2)) * (1 if delta.group(1) == "tăng" else -1)
    return out


def read_csv(path):
    with path.open(encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--scan", type=int, default=450, help="how many tkIds past the last known one to scan")
    ap.add_argument("--csv", type=Path, default=CSV_PATH, help="CSV to update (default: data/monthly_customs_truck_imports.csv)")
    args = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")

    rows = read_csv(args.csv)
    have = {(int(r["year"]), int(r["month"])) for r in rows}
    last_ym = max(have)
    tk_ids = [int(m.group(1)) for r in rows if (m := re.search(r"tkId=(\d+)", r["source_url"] or ""))]
    start_tk = max(tk_ids) + 1

    with ThreadPoolExecutor(8) as ex:
        results = list(ex.map(fetch, range(start_tk, start_tk + args.scan)))

    reports = {}
    # Past-the-end tkIds legitimately come back empty, but every single one
    # failing means the API is down/changed -- fail loudly rather than
    # reporting a quiet month.
    if not any(item for _, item in results):
        sys.exit(f"ERROR: all {args.scan} Customs API fetches from tkId {start_tk} returned nothing -- API down or changed?")

    for tk_id, item in results:
        if not item:
            continue
        m = TITLE_RE.search(unicodedata.normalize("NFC", item.get("TIEU_DE") or ""))
        if not m:
            continue
        ym = (int(m.group(2)), int(m.group(1)))
        if ym > last_ym and ym not in reports:
            reports[ym] = (tk_id, parse_truck_section(clean_text(item.get("NOI_DUNG"))))

    if not reports:
        print(f"No new months (latest in CSV: {last_ym[0]}-{last_ym[1]:02d}; scanned tkId {start_tk}-{start_tk + args.scan - 1}).")
        return

    new_rows = []
    problems = []
    for ym in sorted(reports):
        tk_id, p = reports[ym]
        if p["total"] is None or p["china"] is None:
            problems.append(f"{ym[0]}-{ym[1]:02d} (tkId {tk_id}): could not parse total/China -- enter manually")
            continue

        # Back-fill a skipped month from this report's MoM wording.
        prev = (ym[0] - 1, 12) if ym[1] == 1 else (ym[0], ym[1] - 1)
        if prev > last_ym and prev not in reports:
            def back_out(cur, pct):
                return round(cur / (1 + pct / 100)) if pct is not None and pct != -100 else None

            if p["china_mom_delta"] is not None:
                china_prev, china_est = p["china"] - p["china_mom_delta"], 0
            else:
                china_prev, china_est = back_out(p["china"], p["china_mom_pct"]), 1
            total_prev = back_out(p["total"], p["total_mom_pct"])
            new_rows.append({
                "year": prev[0], "month": prev[1],
                "china_units": china_prev if china_prev is not None else "",
                "total_units": total_prev if total_prev is not None else "",
                "total_value_usd": "", "china_estimated": china_est, "total_estimated": 1,
                "source_url": SOURCE_URL.format(tk_id),
                "note": f"No report of its own; DERIVED from MoM in {ym[0]}-{ym[1]:02d} report ({tk_id})",
            })

        new_rows.append({
            "year": ym[0], "month": ym[1], "china_units": p["china"], "total_units": p["total"],
            "total_value_usd": p["value_usd"] if p["value_usd"] is not None else "",
            "china_estimated": 0, "total_estimated": 0,
            "source_url": SOURCE_URL.format(tk_id), "note": "",
        })

    for r in new_rows:
        print(f"{r['year']}-{int(r['month']):02d}: China {r['china_units']}, total {r['total_units']}, "
              f"value {r['total_value_usd']}, est={r['china_estimated']}/{r['total_estimated']}  {r['source_url']}")
    for msg in problems:
        print("WARNING:", msg)

    if args.dry_run or not new_rows:
        return
    with args.csv.open("a", encoding="utf-8", newline="") as f:
        csv.DictWriter(f, fieldnames=FIELDS, lineterminator="\n").writerows(new_rows)
    print(f"Appended {len(new_rows)} row(s) to {args.csv.name}")


if __name__ == "__main__":
    main()
