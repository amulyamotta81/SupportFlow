"""
build_kb.py
-----------
Builds a FAISS knowledge base from support-ticket CSV/JSON files.
Optimised for "How do I fix X?" RAG queries.

COLUMN MAPPING
--------------
The following columns are read (case-insensitive, underscore/space variants accepted):

  REQUIRED
    Issue field     → Issue_Description / issue / problem / title / summary …
    Resolution field→ Resolution_Steps  / resolution / solution / fix / answer …

  ENRICHMENT (used to build richer embeddings + stored as metadata)
    Root cause      → Root_Cause / root_cause / cause …
    Category        → Category  (CSV value kept as fallback)
    Sub-category    → Sub_Category / sub_category / subcategory …
    Priority        → Priority  (CSV value kept as fallback)
    Severity        → Severity  / sev / severity_level …
    Status          → Status    / ticket_status …
    Ticket ID       → Ticket_ID / ticket_id / id …

CATEGORY / PRIORITY STRATEGY
------------------------------
  1. Infer category from issue + root_cause text (keyword scoring).
  2. If inference returns "General", fall back to the CSV Category value.
  3. Infer priority from urgency tone in issue text.
  4. If inference returns "Low" AND the CSV priority is higher, use CSV value.

EMBEDDING STRATEGY
------------------
  The text that gets embedded is a rich multi-field blob:
    [ISSUE]       <Issue_Description>
    [CAUSE]       <Root_Cause>          (if present)
    [CATEGORY]    <Category> > <Sub_Category>
    [RESOLUTION]  <Resolution_Steps>

  This makes semantic search work for queries like:
    "VMware vMotion failing"  →  matches issue text
    "RAID rebuild"            →  matches root cause
    "CPU feature sets"        →  matches root cause
    "check HBA queue depth"   →  matches resolution steps

Usage:
  python build_kb.py --csv tickets.csv
  python build_kb.py --csv file1.csv file2.csv
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

# ── Column aliases ─────────────────────────────────────────────────────────────

ISSUE_ALIASES = [
    "issue_description", "issue", "customer_issue", "problem", "title",
    "question", "summary", "subject", "incident", "request", "ticket_title",
    "issue_title", "error", "complaint", "query", "topic", "name",
]

RESOLUTION_ALIASES = [
    "resolution_steps", "resolution", "tech_response", "solution", "answer",
    "fix", "response", "resolve", "resolved_by", "fix_steps", "remedy",
    "action_taken", "steps", "workaround", "result", "outcome",
    "closing_notes",
]

ROOT_CAUSE_ALIASES = [
    "root_cause", "rootcause", "cause", "root cause", "failure_reason",
    "reason", "diagnosis", "error_cause",
]

CATEGORY_ALIASES = [
    "category", "cat", "ticket_category", "issue_category", "type",
]

SUBCATEGORY_ALIASES = [
    "sub_category", "subcategory", "sub-category", "sub_cat",
    "issue_type", "issue_subtype", "sub_type",
]

PRIORITY_ALIASES = [
    "priority", "ticket_priority", "urgency", "priority_level",
]

SEVERITY_ALIASES = [
    "severity", "sev", "severity_level", "impact", "criticality",
]

STATUS_ALIASES = [
    "status", "ticket_status", "state", "resolution_status",
]

TICKET_ID_ALIASES = [
    "ticket_id", "ticket_no", "ticket_number", "id", "tkt_id",
    "ticketid", "case_id", "incident_id",
]

# ── Category inference ─────────────────────────────────────────────────────────

CATEGORY_KEYWORDS = {
    "VPN": {
        "strong": ["vpn", "anyconnect", "openvpn", "wireguard", "remote access", "tunnel"],
        "weak":   ["remote", "connect from home", "work from home", "wfh"],
    },
    "Network": {
        "strong": ["wifi", "wi-fi", "wireless", "ethernet", "network", "internet",
                   "firewall", "dns", "dhcp", "ip address", "router", "switch",
                   "bandwidth", "latency", "packet loss", "connectivity",
                   "vmotion", "vmkernel", "vlan", "esxi"],
        "weak":   ["connection", "connected", "offline", "online", "ping", "slow internet"],
    },
    "Security": {
        "strong": ["virus", "malware", "ransomware", "phishing", "breach", "hacked",
                   "unauthorized", "certificate", "ssl", "tls", "mfa", "2fa",
                   "suspicious", "threat", "intrusion", "compromised", "lockout"],
        "weak":   ["security", "password expired", "account locked", "suspicious email"],
    },
    "Hardware": {
        "strong": ["laptop", "desktop", "monitor", "keyboard", "mouse", "printer",
                   "scanner", "webcam", "headset", "battery", "charger", "ram",
                   "hard drive", "ssd", "cpu", "overheating", "fan noise",
                   "blue screen", "bsod", "hardware failure", "device not recognized",
                   "hba", "disk", "drive", "san", "lun", "raid"],
        "weak":   ["physical", "broken", "damaged", "not turning on", "won't start"],
    },
    "Cloud & Servers": {
        "strong": ["vmware", "esxi", "vsphere", "vcenter", "hypervisor", "vm",
                   "virtual machine", "cloud", "aws", "azure", "gcp", "server",
                   "host", "cluster", "datastore", "snapshot", "vsan"],
        "weak":   ["instance", "node", "container", "pod", "deploy"],
    },
    "Storage & Backup": {
        "strong": ["storage", "backup", "restore", "san", "nas", "lun", "raid",
                   "replication", "snapshot", "tape", "archive", "deduplication",
                   "i/o", "iops", "latency", "throughput", "array"],
        "weak":   ["disk space", "full disk", "out of space", "slow read", "slow write"],
    },
    "Software": {
        "strong": ["install", "uninstall", "update", "upgrade", "patch", "application",
                   "app", "software", "program", "crash", "freeze", "license",
                   "activation", "windows", "macos", "linux", "office", "teams",
                   "zoom", "browser", "driver", "plugin", "extension"],
        "weak":   ["not opening", "keeps closing", "slow app", "not responding"],
    },
    "Email": {
        "strong": ["email", "outlook", "mail", "inbox", "smtp", "imap", "calendar",
                   "attachment", "spam", "phishing email", "bounce", "signature",
                   "distribution list", "shared mailbox", "exchange"],
        "weak":   ["message", "send", "receive", "mailbox full"],
    },
    "Account": {
        "strong": ["account", "login", "password", "reset password", "active directory",
                   "ad", "ldap", "sso", "single sign-on", "access denied",
                   "permission", "group policy", "user account", "credentials",
                   "locked out", "two factor", "authenticator"],
        "weak":   ["cannot log in", "forgot password", "new employee", "onboarding"],
    },
}

CATEGORY_BASE_PRIORITY = {
    "Security":         "High",
    "VPN":              "High",
    "Cloud & Servers":  "High",
    "Storage & Backup": "Medium",
    "Network":          "Medium",
    "Hardware":         "Medium",
    "Software":         "Medium",
    "Email":            "Medium",
    "Account":          "Medium",
    "General":          "Low",
}

PRIORITY_ORDER = ["Critical", "High", "Medium", "Low"]

URGENCY_TONE = {
    "Critical": [
        "urgent", "emergency", "critical", "immediately", "asap", "right now",
        "entire company", "all users", "everyone affected", "production down",
        "system down", "server down", "outage", "data loss", "breach",
        "ransomware", "hacked", "business stopped", "deadline today",
    ],
    "High": [
        "not working", "cannot connect", "completely blocked",
        "cannot access", "failed", "keeps crashing", "blue screen", "bsod",
        "virus", "malware", "vpn down", "no internet", "locked out",
        "need immediately", "affecting work", "cannot do my job",
    ],
    "Medium": [
        "slow", "intermittent", "sometimes", "occasionally", "degraded",
        "not syncing", "partially working", "some features", "error message",
        "need help", "having trouble", "issue with", "problem with",
    ],
    "Low": [
        "minor", "when convenient", "not urgent", "low priority", "nice to have",
        "cosmetic", "question about", "how to", "wondering if", "curious",
    ],
}

# Maps CSV severity strings to priority equivalents for fallback comparison
SEV_TO_PRIORITY = {
    "sev1": "Critical", "sev-1": "Critical", "severity 1": "Critical", "1": "Critical",
    "sev2": "High",     "sev-2": "High",     "severity 2": "High",     "2": "High",
    "sev3": "Medium",   "sev-3": "Medium",   "severity 3": "Medium",   "3": "Medium",
    "sev4": "Low",      "sev-4": "Low",      "severity 4": "Low",      "4": "Low",
}

# ── Helper: column finder ──────────────────────────────────────────────────────

def find_column(df_cols: list, aliases: list) -> str | None:
    """Return the first df column name that matches any alias (case-insensitive)."""
    cols_lower = {c.lower().strip().replace(" ", "_"): c for c in df_cols}
    for alias in aliases:
        normalised = alias.lower().strip().replace(" ", "_")
        if normalised in cols_lower:
            return cols_lower[normalised]
    return None


# ── Inference helpers ──────────────────────────────────────────────────────────

def infer_category(issue: str, root_cause: str = "", csv_category: str = "") -> str:
    """
    Score keywords in issue + root_cause.
    Falls back to csv_category if inference result is 'General'.
    """
    text = (issue + " " + root_cause).lower()
    scores: dict[str, int] = {}
    for cat, kw_groups in CATEGORY_KEYWORDS.items():
        score  = sum(2 for k in kw_groups["strong"] if k in text)
        score += sum(1 for k in kw_groups["weak"]   if k in text)
        scores[cat] = score

    best_score = max(scores.values())
    if best_score == 0:
        # Nothing matched — fall back to CSV value if available
        return csv_category.strip() if csv_category.strip() else "General"

    best_cats = [c for c, s in scores.items() if s == best_score]
    if len(best_cats) == 1:
        return best_cats[0]

    # Tie-break by priority order list
    priority_order = ["Security", "VPN", "Cloud & Servers", "Storage & Backup",
                      "Network", "Hardware", "Software", "Email", "Account"]
    for p in priority_order:
        if p in best_cats:
            return p
    return best_cats[0]


def _priority_rank(p: str) -> int:
    """Lower index = higher priority."""
    try:
        return PRIORITY_ORDER.index(p)
    except ValueError:
        return len(PRIORITY_ORDER)


def infer_priority(issue: str, root_cause: str = "",
                   category: str = "General",
                   csv_priority: str = "",
                   csv_severity: str = "") -> str:
    """
    1. Tone-based detection from issue + root_cause text.
    2. If tone says 'Low', compare against CSV priority / severity and take
       whichever is higher (i.e. more urgent).
    3. Final fallback: category default severity.
    """
    text = (issue + " " + root_cause).lower()

    inferred = None
    for level in ["Critical", "High", "Medium", "Low"]:
        if any(kw in text for kw in URGENCY_TONE[level]):
            inferred = level
            break

    if inferred is None:
        inferred = CATEGORY_BASE_PRIORITY.get(category, "Low")

    # Collect candidate priorities to compare
    candidates = [inferred]

    if csv_priority.strip():
        p = csv_priority.strip().capitalize()
        if p in PRIORITY_ORDER:
            candidates.append(p)

    if csv_severity.strip():
        mapped = SEV_TO_PRIORITY.get(csv_severity.strip().lower())
        if mapped:
            candidates.append(mapped)

    # Return the highest (lowest rank index)
    return min(candidates, key=_priority_rank)


# ── File loading ───────────────────────────────────────────────────────────────

def load_file(path: str) -> pd.DataFrame:
    ext = Path(path).suffix.lower()
    if ext == ".csv":
        for enc in ["utf-8", "latin-1", "cp1252"]:
            try:
                df = pd.read_csv(path, encoding=enc)
                df.columns = df.columns.str.strip()
                return df
            except UnicodeDecodeError:
                continue
        raise ValueError(f"Cannot decode {path} with utf-8/latin-1/cp1252")
    elif ext == ".json":
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, list):
            return pd.DataFrame(data)
        if isinstance(data, dict):
            for key in ["tickets", "data", "records", "items", "results"]:
                if key in data:
                    return pd.DataFrame(data[key])
            return pd.DataFrame([data])
        raise ValueError(f"Unrecognised JSON structure in {path}")
    else:
        raise ValueError(f"Unsupported file type: {ext}")


# ── Extraction ─────────────────────────────────────────────────────────────────

def extract_columns(df: pd.DataFrame, source_name: str) -> pd.DataFrame:
    """
    Extract all relevant columns.  Only issue + resolution are required.
    Everything else enriches the KB if present.
    """
    cols = list(df.columns)

    # ── Required ──────────────────────────────────────────────────────────────
    issue_col = find_column(cols, ISSUE_ALIASES)
    res_col   = find_column(cols, RESOLUTION_ALIASES)

    if not issue_col:
        raise ValueError(
            f"Cannot find issue column in {source_name}.\n"
            f"  Columns: {cols}\n"
            f"  Expected one of: {ISSUE_ALIASES[:6]}..."
        )
    if not res_col:
        raise ValueError(
            f"Cannot find resolution column in {source_name}.\n"
            f"  Columns: {cols}\n"
            f"  Expected one of: {RESOLUTION_ALIASES[:6]}..."
        )

    # ── Optional enrichment columns ───────────────────────────────────────────
    root_cause_col  = find_column(cols, ROOT_CAUSE_ALIASES)
    category_col    = find_column(cols, CATEGORY_ALIASES)
    subcategory_col = find_column(cols, SUBCATEGORY_ALIASES)
    priority_col    = find_column(cols, PRIORITY_ALIASES)
    severity_col    = find_column(cols, SEVERITY_ALIASES)
    status_col      = find_column(cols, STATUS_ALIASES)
    ticket_id_col   = find_column(cols, TICKET_ID_ALIASES)

    found = {
        "issue":       issue_col,
        "resolution":  res_col,
        "root_cause":  root_cause_col  or "(none)",
        "category":    category_col    or "(none)",
        "subcategory": subcategory_col or "(none)",
        "priority":    priority_col    or "(none)",
        "severity":    severity_col    or "(none)",
        "status":      status_col      or "(none)",
        "ticket_id":   ticket_id_col   or "(none)",
    }
    print("   Column mapping:")
    for field, col in found.items():
        print(f"     {field:<12} → {col}")

    def safe_col(c):
        return df[c].astype(str).str.strip() if c else pd.Series([""] * len(df))

    result = pd.DataFrame({
        "issue":       df[issue_col].astype(str).str.strip(),
        "resolution":  df[res_col].astype(str).str.strip(),
        "root_cause":  safe_col(root_cause_col),
        "csv_category":    safe_col(category_col),
        "subcategory": safe_col(subcategory_col),
        "csv_priority":    safe_col(priority_col),
        "severity":    safe_col(severity_col),
        "status":      safe_col(status_col),
        "ticket_id":   safe_col(ticket_id_col),
        "_source":     source_name,
    })

    return result


# ── Cleaning ───────────────────────────────────────────────────────────────────

BAD_VALUES = {"nan", "none", "null", "n/a", "na", "-", "", "unknown", "tbd", "?"}

def _is_bad(s: str) -> bool:
    return str(s).strip().lower() in BAD_VALUES

def clean(df: pd.DataFrame) -> pd.DataFrame:
    before = len(df)
    df = df.dropna(subset=["issue", "resolution"])
    df = df[~df["issue"].apply(_is_bad)]
    df = df[~df["resolution"].apply(_is_bad)]
    df = df[df["issue"].str.strip().str.len() >= 5]
    df = df[df["resolution"].str.strip().str.len() >= 10]
    df = df.drop_duplicates(subset=["issue", "resolution"])
    df = df.reset_index(drop=True)
    print(f"   Cleaned: {before} → {len(df)} rows ({before - len(df)} removed)")
    return df


# ── Enrichment ─────────────────────────────────────────────────────────────────

def enrich(df: pd.DataFrame) -> pd.DataFrame:
    """
    Compute final category and priority using:
      1. Text inference
      2. CSV fallback when inference is weak
    """
    print("   Computing categories (infer → CSV fallback)...")
    df["category"] = df.apply(
        lambda r: infer_category(
            r["issue"],
            r.get("root_cause", ""),
            r.get("csv_category", ""),
        ),
        axis=1,
    )

    print("   Computing priorities (infer → CSV fallback → severity)...")
    df["priority"] = df.apply(
        lambda r: infer_priority(
            r["issue"],
            r.get("root_cause", ""),
            r["category"],
            r.get("csv_priority", ""),
            r.get("severity", ""),
        ),
        axis=1,
    )

    return df


# ── Rich text builder (what gets embedded) ────────────────────────────────────

def build_rich_text(row: pd.Series) -> str:
    """
    Builds the text blob that gets embedded into the FAISS vector.

    Structure:
        [ISSUE]      <issue>
        [CAUSE]      <root_cause>          (skipped if empty)
        [CATEGORY]   <category> > <sub>    (skipped if empty)
        [RESOLUTION] <resolution>

    Including root_cause and category/sub-category in the embedding means
    queries like "CPU feature mismatch" or "RAID rebuild" will match the
    correct ticket even if those words don't appear in the issue title.
    """
    parts = [f"[ISSUE] {row['issue'].strip()}"]

    rc = str(row.get("root_cause", "")).strip()
    if rc and not _is_bad(rc):
        parts.append(f"[CAUSE] {rc}")

    cat = str(row.get("category", "")).strip()
    sub = str(row.get("subcategory", "")).strip()
    if cat and not _is_bad(cat):
        cat_text = cat + (" > " + sub if sub and not _is_bad(sub) else "")
        parts.append(f"[CATEGORY] {cat_text}")

    parts.append(f"[RESOLUTION] {row['resolution'].strip()}")
    return " | ".join(parts)


# ── Embedding ──────────────────────────────────────────────────────────────────

def build_embeddings(df: pd.DataFrame) -> np.ndarray:
    print(f"\n🤖 Loading embedding model: {MODEL_NAME}")
    model = SentenceTransformer(MODEL_NAME)
    texts = df.apply(build_rich_text, axis=1).tolist()
    print(f"   Embedding {len(texts)} entries...")
    embeddings = model.encode(texts, show_progress_bar=True, batch_size=32)
    # L2-normalise for cosine similarity via IndexFlatIP
    norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
    norms[norms == 0] = 1
    return (embeddings / norms).astype("float32")


# ── Save ───────────────────────────────────────────────────────────────────────

def save(embeddings: np.ndarray, df: pd.DataFrame, out_dir: str):
    import faiss
    os.makedirs(out_dir, exist_ok=True)
    faiss_path = os.path.join(out_dir, "kb.faiss")
    meta_path  = os.path.join(out_dir, "kb_metadata.pkl")

    dim   = embeddings.shape[1]
    index = faiss.IndexFlatIP(dim)
    index.add(embeddings)
    faiss.write_index(index, faiss_path)

    metadata = []
    for _, row in df.iterrows():
        entry = {
            # ── Core RAG fields ───────────────────────────────────────────
            "issue":       row["issue"].strip(),
            "resolution":  row["resolution"].strip(),
            "root_cause":  str(row.get("root_cause",  "")).strip(),

            # ── Computed fields ───────────────────────────────────────────
            "category":    row["category"],       # inferred (+ CSV fallback)
            "priority":    row["priority"],       # inferred (+ CSV fallback)
            "success_rate": 0.85,  # Default success rate for historical tickets

            # ── CSV metadata passed through ───────────────────────────────
            "subcategory": str(row.get("subcategory", "")).strip(),
            "severity":    str(row.get("severity",    "")).strip(),
            "status":      str(row.get("status",      "")).strip(),
            "ticket_id":   str(row.get("ticket_id",   "")).strip(),

            # ── Provenance ────────────────────────────────────────────────
            "source":      str(row.get("_source", "csv")),

            # ── Full embedded text (useful for debug / reranking) ─────────
            "embedded_text": build_rich_text(row),
        }
        metadata.append(entry)

    with open(meta_path, "wb") as f:
        pickle.dump(metadata, f)

    print(f"\n✅ FAISS index  → {faiss_path}  ({index.ntotal} vectors, dim={dim})")
    print(f"✅ Metadata     → {meta_path}  ({len(metadata)} entries)")

    # ── Summary ───────────────────────────────────────────────────────────────
    print("\n📊 KB Summary:")
    cat_counts = df["category"].value_counts()
    pri_counts = df["priority"].value_counts()
    sev_counts = df["severity"].value_counts().head(6)
    src_counts = df["_source"].value_counts()

    print("\n  Categories:")
    for cat, cnt in cat_counts.items():
        print(f"    {cat:<20} {cnt:>4} entries")

    print("\n  Priorities:")
    for pri, cnt in pri_counts.items():
        print(f"    {pri:<10} {cnt:>4} entries")

    if not sev_counts.empty and sev_counts.index[0] not in ("", "nan"):
        print("\n  Severities (from CSV):")
        for sev, cnt in sev_counts.items():
            print(f"    {sev:<10} {cnt:>4} entries")

    print("\n  Sources:")
    for src, cnt in src_counts.items():
        print(f"    [{src}]  {cnt} entries")


# ── Load all files ─────────────────────────────────────────────────────────────

def load_all(paths: list[str]) -> pd.DataFrame:
    frames = []
    for p in paths:
        print(f"\n📄 {p}")
        try:
            raw = load_file(p)
            print(f"   Columns found: {list(raw.columns)}")
            extracted = extract_columns(raw, Path(p).name)
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


# ── Verify existing KB ─────────────────────────────────────────────────────────

def verify_kb(out_dir: str):
    import faiss
    from collections import Counter

    faiss_path = os.path.join(out_dir, "kb.faiss")
    meta_path  = os.path.join(out_dir, "kb_metadata.pkl")

    if not os.path.exists(faiss_path):
        print("❌ No KB found. Run: python build_kb.py --csv yourfile.csv")
        return

    index = faiss.read_index(faiss_path)
    with open(meta_path, "rb") as f:
        metadata = pickle.load(f)

    print(f"\n🔍 KB Verification Report")
    print(f"   Vectors  : {index.ntotal}")
    print(f"   Metadata : {len(metadata)}")
    print(f"   Dimension: {index.d}")

    cats = Counter(m["category"]          for m in metadata)
    pris = Counter(m["priority"]          for m in metadata)
    sevs = Counter(m.get("severity", "")  for m in metadata if m.get("severity"))
    srcs = Counter(m.get("source",   "")  for m in metadata)

    print("\n  Categories:")
    for cat, cnt in cats.most_common(): print(f"    {cat:<20} {cnt}")
    print("\n  Priorities:")
    for pri, cnt in pris.most_common():  print(f"    {pri:<10} {cnt}")
    if sevs:
        print("\n  Severities:")
        for sev, cnt in sevs.most_common(6): print(f"    {sev:<10} {cnt}")
    print("\n  Sources:")
    for src, cnt in srcs.most_common():  print(f"    {src:<25} {cnt}")

    live = [m for m in metadata
            if m.get("source", "") in ("admin_resolution", "agent_resolution", "user_confirmed")]
    if live:
        print(f"\n✅ Live KB updates (admin/agent/user): {len(live)}")
        for e in live[-5:]:
            ts = e.get("added_at", "?")[:19]
            print(f"  [{ts}] [{e['source']}] {e['issue'][:55]}")
    else:
        print("\n  No live updates yet.")

    print(f"\n📋 Sample entries (first 3):")
    for e in metadata[:3]:
        print(f"  Ticket     : {e.get('ticket_id', 'N/A')}")
        print(f"  Issue      : {e['issue'][:70]}")
        print(f"  Category   : {e['category']} > {e.get('subcategory', '')}  "
              f"| Priority: {e['priority']}  | Severity: {e.get('severity', 'N/A')}")
        root = e.get("root_cause", "")
        if root:
            print(f"  Root Cause : {root[:70]}")
        print(f"  Resolution : {e['resolution'][:90]}...")
        print()


# ── CLI ────────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Build FAISS KB for support-ticket RAG chatbot"
    )
    parser.add_argument("--csv",     nargs="+", default=[], help="CSV or JSON file(s)")
    parser.add_argument("--dir",     default="",            help="Directory of CSV/JSON files")
    parser.add_argument("--out",     default=DEFAULT_OUT_DIR, help="Output directory")
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
            print("   Usage: python build_kb.py --csv tickets.csv")
            print("          python build_kb.py --dir ./data/")
            sys.exit(1)

    df = load_all(paths)
    df = clean(df)

    if args.dry_run:
        print("\n🔍 Dry-run preview (first 5 rows):")
        preview_cols = ["ticket_id", "issue", "resolution", "root_cause",
                        "csv_category", "subcategory", "csv_priority", "severity", "_source"]
        available = [c for c in preview_cols if c in df.columns]
        print(df[available].head(5).to_string())
        print(f"\nTotal: {len(df)} entries ready. Remove --dry-run to build.")
        return

    df         = enrich(df)
    embeddings = build_embeddings(df)
    save(embeddings, df, args.out)
    print("\n🚀 KB ready!")


if __name__ == "__main__":
    main()