"""
build_kb.py
-----------
Builds FAISS knowledge base from one or more CSV/JSON files.

STRICT RULE: Only these columns are ever read from source files:
  - issue / problem / title / question / summary    → mapped to "issue"
  - resolution / solution / answer / fix / response → mapped to "resolution"
  - description / detail / body / notes             → appended to issue text

ALL other columns (priority, category, success_rate, status, ticket_count,
assigned_to, etc.) are COMPLETELY IGNORED regardless of what the CSV contains.

Category   → inferred from issue/description context using keyword scoring
Priority   → inferred from urgency tone + category severity
Similarity → computed live at query time (cosine, not stored)
Confidence → computed live from multi-signal formula (not stored)

Usage:
  python build_kb.py --csv tickets.csv
  python build_kb.py --csv file1.csv file2.csv file3.csv
  python build_kb.py --dir ./data/
  python build_kb.py --csv tickets.csv --dry-run
  python build_kb.py --verify
"""

import os
import re
import sys
import json
import pickle
import argparse
import numpy as np
import pandas as pd
from pathlib import Path
from sentence_transformers import SentenceTransformer

DEFAULT_OUT_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_NAME      = "all-MiniLM-L6-v2"

# ── Column name aliases — all variations across different CSVs ────────────────
ISSUE_ALIASES = [
    "issue","Customer_Issue", "problem", "title", "question", "summary", "subject",
    "incident", "request", "ticket_title", "issue_title", "error",
    "complaint", "query", "topic", "name","Issue_Description"
]
RESOLUTION_ALIASES = [
    "resolution", "Tech_Response","solution", "answer", "fix", "response", "resolve",
    "resolved_by", "fix_steps", "remedy", "action_taken", "steps",
    "workaround", "result", "outcome", "closing_notes", "Resolution_Steps"
]
DESCRIPTION_ALIASES = [
    "description", "detail", "details", "body", "notes", "note",
    "additional_info", "context", "comment", "comments", "message",
    "full_description", "issue_description", "problem_description"
]

# ── Category inference — scored keyword matching ──────────────────────────────
CATEGORY_KEYWORDS = {
    "VPN": {
        "strong": ["vpn", "anyconnect", "openvpn", "wireguard", "remote access", "tunnel"],
        "weak":   ["remote", "connect from home", "work from home", "wfh"]
    },
    "Network": {
        "strong": ["wifi", "wi-fi", "wireless", "ethernet", "network", "internet",
                   "firewall", "dns", "dhcp", "ip address", "router", "switch",
                   "bandwidth", "latency", "packet loss", "connectivity"],
        "weak":   ["connection", "connected", "offline", "online", "ping", "slow internet"]
    },
    "Security": {
        "strong": ["virus", "malware", "ransomware", "phishing", "breach", "hacked",
                   "unauthorized", "certificate", "ssl", "tls", "mfa", "2fa",
                   "suspicious", "threat", "intrusion", "compromised", "lockout"],
        "weak":   ["security", "password expired", "account locked", "suspicious email"]
    },
    "Hardware": {
        "strong": ["laptop", "desktop", "monitor", "keyboard", "mouse", "printer",
                   "scanner", "webcam", "headset", "battery", "charger", "ram",
                   "hard drive", "ssd", "cpu", "overheating", "fan noise",
                   "blue screen", "bsod", "hardware failure", "device not recognized"],
        "weak":   ["physical", "broken", "damaged", "not turning on", "won't start"]
    },
    "Software": {
        "strong": ["install", "uninstall", "update", "upgrade", "patch", "application",
                   "app", "software", "program", "crash", "freeze", "license",
                   "activation", "windows", "macos", "linux", "office", "teams",
                   "zoom", "browser", "driver", "plugin", "extension"],
        "weak":   ["not opening", "keeps closing", "slow app", "not responding"]
    },
    "Email": {
        "strong": ["email", "outlook", "mail", "inbox", "smtp", "imap", "calendar",
                   "attachment", "spam", "phishing email", "bounce", "signature",
                   "distribution list", "shared mailbox", "exchange"],
        "weak":   ["message", "send", "receive", "mailbox full"]
    },
    "Account": {
        "strong": ["account", "login", "password", "reset password", "active directory",
                   "ad", "ldap", "sso", "single sign-on", "access denied",
                   "permission", "group policy", "user account", "credentials",
                   "locked out", "two factor", "authenticator"],
        "weak":   ["cannot log in", "forgot password", "new employee", "onboarding"]
    },
}

# ── Priority inference — tone + category severity ─────────────────────────────
URGENCY_TONE = {
    "Critical": [
        "urgent", "emergency", "critical", "immediately", "asap", "right now",
        "entire company", "all users", "everyone affected", "production down",
        "system down", "server down", "outage", "data loss", "breach", "ransomware",
        "hacked", "cannot work at all", "business stopped", "deadline today"
    ],
    "High": [
        "not working", "cannot connect", "completely blocked", "urgent",
        "cannot access", "failed", "keeps crashing", "blue screen", "bsod",
        "virus", "malware", "vpn down", "no internet", "locked out",
        "need immediately", "affecting work", "cannot do my job"
    ],
    "Medium": [
        "slow", "intermittent", "sometimes", "occasionally", "degraded",
        "not syncing", "partially working", "some features", "error message",
        "need help", "having trouble", "issue with", "problem with"
    ],
    "Low": [
        "minor", "when convenient", "not urgent", "low priority", "nice to have",
        "cosmetic", "question about", "how to", "wondering if", "curious"
    ]
}

# Category default priority (if tone is neutral)
CATEGORY_BASE_PRIORITY = {
    "Security": "High",
    "VPN":      "High",
    "Network":  "Medium",
    "Hardware": "Medium",
    "Software": "Medium",
    "Email":    "Medium",
    "Account":  "Medium",
    "General":  "Low",
}


def infer_category(issue: str, description: str = "") -> str:
    """Score-based category inference. Strong keyword = 2pts, weak = 1pt."""
    text = (issue + " " + description).lower()
    scores = {}
    for cat, kw_groups in CATEGORY_KEYWORDS.items():
        score = 0
        score += sum(2 for k in kw_groups["strong"] if k in text)
        score += sum(1 for k in kw_groups["weak"]   if k in text)
        scores[cat] = score
    best_score = max(scores.values())
    if best_score == 0:
        return "General"
    # If tie, pick the one with higher base priority
    best_cats = [c for c, s in scores.items() if s == best_score]
    if len(best_cats) == 1:
        return best_cats[0]
    priority_order = ["Security", "VPN", "Network", "Hardware", "Software", "Email", "Account"]
    for p in priority_order:
        if p in best_cats:
            return p
    return best_cats[0]


def infer_priority(issue: str, description: str = "", category: str = "General") -> str:
    """
    Two-signal priority:
    1. Urgency tone from issue/description text
    2. Category default severity as fallback
    """
    text = (issue + " " + description).lower()

    # Tone-based detection (highest tone wins)
    for level in ["Critical", "High", "Medium", "Low"]:
        if any(kw in text for kw in URGENCY_TONE[level]):
            return level

    # No tone detected — use category default
    return CATEGORY_BASE_PRIORITY.get(category, "Low")


def find_column(df_cols: list, aliases: list) -> str | None:
    """Find first matching column name from aliases list."""
    cols_lower = {c.lower().strip(): c for c in df_cols}
    for alias in aliases:
        if alias in cols_lower:
            return cols_lower[alias]
        # Also try with spaces replaced by underscores and vice versa
        alt = alias.replace("_", " ")
        if alt in cols_lower:
            return cols_lower[alt]
    return None


def load_file(path: str) -> pd.DataFrame:
    """Load CSV or JSON, return raw dataframe."""
    ext = Path(path).suffix.lower()
    if ext == ".csv":
        # Try common encodings
        for enc in ["utf-8", "latin-1", "cp1252"]:
            try:
                df = pd.read_csv(path, encoding=enc)
                df.columns = df.columns.str.strip()
                return df
            except UnicodeDecodeError:
                continue
        raise ValueError(f"Cannot decode {path}")
    elif ext == ".json":
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, list):
            return pd.DataFrame(data)
        if isinstance(data, dict):
            # Try common keys
            for key in ["tickets", "data", "records", "items", "results"]:
                if key in data:
                    return pd.DataFrame(data[key])
            return pd.DataFrame([data])
        raise ValueError(f"Unrecognised JSON structure in {path}")
    else:
        raise ValueError(f"Unsupported file type: {ext}")


def extract_issue_resolution(df: pd.DataFrame, source_name: str) -> pd.DataFrame:
    """
    STRICT: Only extract issue + resolution + description text.
    All other columns are DROPPED and IGNORED.
    """
    cols = list(df.columns)

    issue_col   = find_column(cols, ISSUE_ALIASES)
    res_col     = find_column(cols, RESOLUTION_ALIASES)
    desc_col    = find_column(cols, DESCRIPTION_ALIASES)

    if not issue_col:
        raise ValueError(
            f"Cannot find issue column in {source_name}.\n"
            f"  Available columns: {cols}\n"
            f"  Expected one of: {ISSUE_ALIASES[:8]}..."
        )
    if not res_col:
        raise ValueError(
            f"Cannot find resolution column in {source_name}.\n"
            f"  Available columns: {cols}\n"
            f"  Expected one of: {RESOLUTION_ALIASES[:8]}..."
        )

    print(f"   Mapped: issue='{issue_col}', resolution='{res_col}'"
          + (f", description='{desc_col}'" if desc_col else " (no description col)"))

    result = pd.DataFrame()
    result["issue"]       = df[issue_col].astype(str)
    result["resolution"]  = df[res_col].astype(str)
    result["description"] = df[desc_col].astype(str) if desc_col else ""
    result["_source"]     = source_name

    return result


def clean(df: pd.DataFrame) -> pd.DataFrame:
    """Remove empty, null, placeholder rows. Deduplicate."""
    before = len(df)

    # Drop nulls
    df = df.dropna(subset=["issue", "resolution"])

    # Drop empty strings and placeholder values
    bad_values = {"nan", "none", "null", "n/a", "na", "-", "", "unknown", "tbd", "?"}
    df = df[~df["issue"].str.strip().str.lower().isin(bad_values)]
    df = df[~df["resolution"].str.strip().str.lower().isin(bad_values)]

    # Minimum length — at least 5 chars each
    df = df[df["issue"].str.strip().str.len() >= 5]
    df = df[df["resolution"].str.strip().str.len() >= 10]

    # Deduplicate on issue+resolution
    df = df.drop_duplicates(subset=["issue", "resolution"])
    df = df.reset_index(drop=True)

    print(f"   Cleaned: {before} → {len(df)} rows ({before - len(df)} removed)")
    return df


def enrich(df: pd.DataFrame) -> pd.DataFrame:
    """
    Compute category and priority from text context only.
    NEVER read these from CSV — always compute fresh.
    """
    print("   Computing categories from issue context...")
    df["category"] = df.apply(
        lambda r: infer_category(r["issue"], r.get("description", "")), axis=1
    )

    print("   Computing priorities from urgency tone + category...")
    df["priority"] = df.apply(
        lambda r: infer_priority(r["issue"], r.get("description", ""), r["category"]), axis=1
    )

    return df


def build_rich_text(row: pd.Series) -> str:
    """
    Build the text that gets embedded.
    Combines issue + description + resolution for richer semantic matching.
    """
    parts = [row["issue"].strip()]
    desc = str(row.get("description", "")).strip()
    if desc and desc.lower() not in ("nan", "none", ""):
        parts.append(desc)
    parts.append(row["resolution"].strip())
    return " | ".join(parts)


def build_embeddings(df: pd.DataFrame) -> np.ndarray:
    print(f"\n🤖 Loading embedding model: {MODEL_NAME}")
    model = SentenceTransformer(MODEL_NAME)
    texts = df.apply(build_rich_text, axis=1).tolist()
    print(f"   Embedding {len(texts)} entries...")
    embeddings = model.encode(texts, show_progress_bar=True, batch_size=32)
    # L2 normalise for cosine similarity via IndexFlatIP
    norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
    norms[norms == 0] = 1
    return (embeddings / norms).astype("float32")


def save(embeddings: np.ndarray, df: pd.DataFrame, out_dir: str):
    import faiss
    os.makedirs(out_dir, exist_ok=True)
    faiss_path = os.path.join(out_dir, "kb.faiss")
    meta_path  = os.path.join(out_dir, "kb_metadata.pkl")

    dim   = embeddings.shape[1]
    index = faiss.IndexFlatIP(dim)
    index.add(embeddings)
    faiss.write_index(index, faiss_path)

    # Metadata stores ONLY what we computed — never raw CSV values
    metadata = []
    for _, row in df.iterrows():
        metadata.append({
            "issue":       row["issue"].strip(),
            "resolution":  row["resolution"].strip(),
            "description": str(row.get("description", "")).strip(),
            "category":    row["category"],   # computed, not from CSV
            "priority":    row["priority"],   # computed, not from CSV
            "source":      str(row.get("_source", "csv")),
        })

    with open(meta_path, "wb") as f:
        pickle.dump(metadata, f)

    # Print summary
    print(f"\n✅ FAISS index  → {faiss_path}  ({index.ntotal} vectors, dim={dim})")
    print(f"✅ Metadata     → {meta_path}  ({len(metadata)} entries)")
    print("\n📊 KB Summary:")
    cat_counts = df["category"].value_counts()
    pri_counts = df["priority"].value_counts()
    src_counts = df["_source"].value_counts()
    for cat, cnt in cat_counts.items(): print(f"   {cat:<15} {cnt} entries")
    print()
    for pri, cnt in pri_counts.items(): print(f"   {pri:<10} {cnt} entries")
    print()
    for src, cnt in src_counts.items(): print(f"   [{src}] {cnt} entries")


def load_all(paths: list[str]) -> pd.DataFrame:
    frames = []
    for p in paths:
        print(f"\n📄 {p}")
        try:
            raw = load_file(p)
            print(f"   Columns found: {list(raw.columns)}")
            extracted = extract_issue_resolution(raw, Path(p).name)
            frames.append(extracted)
            print(f"   Loaded {len(extracted)} rows")
        except ValueError as e:
            print(f"   ⚠️  Skipped: {e}")
        except Exception as e:
            print(f"   ❌ Error: {e}")

    if not frames:
        print("\n❌ No files loaded successfully.")
        sys.exit(1)

    combined = pd.concat(frames, ignore_index=True)
    print(f"\n📦 Combined: {len(combined)} total rows from {len(frames)} file(s)")
    return combined


def verify_kb(out_dir: str):
    """Check KB contents — including admin-resolved entries."""
    import faiss
    faiss_path = os.path.join(out_dir, "kb.faiss")
    meta_path  = os.path.join(out_dir, "kb_metadata.pkl")

    if not os.path.exists(faiss_path):
        print("❌ No KB found. Run build_kb.py --csv yourfile.csv first.")
        return

    index = faiss.read_index(faiss_path)
    with open(meta_path, "rb") as f:
        metadata = pickle.load(f)

    print(f"\n🔍 KB Verification Report")
    print(f"   Vectors  : {index.ntotal}")
    print(f"   Metadata : {len(metadata)}")
    print(f"   Dimension: {index.d}")

    # Category breakdown
    from collections import Counter
    cats = Counter(m["category"] for m in metadata)
    pris = Counter(m["priority"] for m in metadata)
    srcs = Counter(m.get("source", "csv") for m in metadata)

    print("\n   Categories:")
    for cat, cnt in cats.most_common(): print(f"     {cat:<15} {cnt}")
    print("\n   Priorities:")
    for pri, cnt in pris.most_common(): print(f"     {pri:<10} {cnt}")
    print("\n   Sources:")
    for src, cnt in srcs.most_common(): print(f"     {src:<25} {cnt}")

    # Admin/agent resolutions
    live_updates = [m for m in metadata
                    if m.get("source", "") in ("admin_resolution", "agent_resolution", "user_confirmed")]
    if live_updates:
        print(f"\n✅ Live KB updates (admin/agent/user): {len(live_updates)}")
        for e in live_updates[-5:]:
            ts = e.get("added_at", "?")[:19]
            print(f"   [{ts}] [{e['source']}] {e['issue'][:55]}")
    else:
        print("\n   No live updates yet (admin/agent resolutions appear here after KB update)")

    # Sample entries
    print(f"\n📋 Sample entries (first 3):")
    for e in metadata[:3]:
        print(f"   Issue     : {e['issue'][:60]}")
        print(f"   Category  : {e['category']} | Priority: {e['priority']}")
        print(f"   Resolution: {e['resolution'][:80]}...")
        print()


def main():
    parser = argparse.ArgumentParser(
        description="Build FAISS KB — only issue+resolution used from CSV"
    )
    parser.add_argument("--csv",     nargs="+", default=[], help="CSV or JSON files")
    parser.add_argument("--dir",     default="",            help="Directory of files")
    parser.add_argument("--out",     default=DEFAULT_OUT_DIR)
    parser.add_argument("--dry-run", action="store_true",   help="Preview without building")
    parser.add_argument("--verify",  action="store_true",   help="Inspect existing KB")
    args = parser.parse_args()

    if args.verify:
        verify_kb(args.out)
        return

    paths = list(args.csv)
    if args.dir:
        d = Path(args.dir)
        paths += [str(p) for p in d.glob("*.csv")]
        paths += [str(p) for p in d.glob("*.json")]

    if not paths:
        default = os.getenv("KB_CSV_PATH", "")
        if default and os.path.exists(default):
            paths = [default]
        else:
            print("❌ No files specified.")
            print("   Usage: python build_kb.py --csv file1.csv file2.csv")
            print("          python build_kb.py --dir ./data/")
            sys.exit(1)

    df = load_all(paths)
    df = clean(df)

    if args.dry_run:
        print("\n🔍 Dry run preview:")
        print(df[["issue", "resolution", "_source"]].head(5).to_string())
        print(f"\nTotal: {len(df)} entries ready. Remove --dry-run to build.")
        return

    df         = enrich(df)
    embeddings = build_embeddings(df)
    save(embeddings, df, args.out)
    print("\n🚀 KB ready!")


if __name__ == "__main__":
    main()