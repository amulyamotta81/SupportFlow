"""
reclassify_tickets.py
---------------------
Standalone script to reclassify all seeded tickets in MongoDB
using a deterministic keyword-based mapping for known IT issues,
with DistilBERT zero-shot as a fallback for unknown issues.

- Connects directly to MongoDB
- Fetches tickets that haven't been reclassified yet
- Uses keyword mapping for accurate classification of known issue types
- Updates category and priority in the database
- Skips already-processed tickets (tracks via aiAnalysis.classifiedByDistilBERT flag)

Usage:
    cd ai-service/app
    python reclassify_tickets.py

    # Dry run (preview changes without writing to DB):
    python reclassify_tickets.py --dry-run

    # Force re-process all tickets (even previously classified):
    python reclassify_tickets.py --force
"""

import sys
import os
import argparse
from pymongo import MongoClient
from dotenv import load_dotenv

# Add app dir to path so we can import the classification chain
APP_DIR = os.path.dirname(os.path.abspath(__file__))
if APP_DIR not in sys.path:
    sys.path.insert(0, APP_DIR)


# ── Keyword-based category mapping for known IT issues ───────────────────────
# Maps keyword patterns (checked in order) to the correct category.
# This is far more accurate than zero-shot NLI for well-known IT ticket types.

ISSUE_CATEGORY_RULES = [
    # Network issues
    (["vpn", "vpn not connecting"], "Network"),
    (["wifi", "wi-fi", "wifi drops"], "Network"),
    (["slow internet", "internet connection"], "Network"),
    (["network drive", "network not accessible"], "Network"),
    (["dns", "firewall blocking"], "Security"),

    # Hardware issues
    (["printer", "cannot print"], "Hardware"),
    (["monitor flickering", "external monitor not detected"], "Hardware"),
    (["mouse not responding"], "Hardware"),
    (["keyboard keys stuck", "keyboard"], "Hardware"),
    (["laptop slow", "laptop replacement"], "Hardware"),
    (["usb ports"], "Hardware"),
    (["webcam not detected", "webcam"], "Hardware"),
    (["projector not displaying", "projector"], "Hardware"),
    (["blue screen", "bsod"], "Hardware"),
    (["phone system not working"], "Hardware"),

    # Software issues
    (["software installation"], "Software"),
    (["application crash", "crash on startup"], "Software"),
    (["excel freezing", "excel"], "Software"),
    (["outlook crashing", "outlook"], "Software"),
    (["windows update failed", "windows update"], "Software"),
    (["remote desktop not working", "remote desktop"], "Software"),
    (["teams meeting", "teams audio"], "Software"),
    (["conference room booking system"], "Software"),
    (["crm system"], "Software"),
    (["sap access"], "Software"),

    # Email issues
    (["cannot access email", "email"], "Email"),
    (["voicemail full", "voicemail"], "Email"),

    # Security issues
    (["certificate expired"], "Security"),
    (["antivirus", "antivirus update"], "Security"),
    (["security breach", "ransomware"], "Security"),

    # Account issues
    (["login credentials", "credentials not working"], "Account"),
    (["password reset"], "Account"),
    (["two-factor authentication", "2fa", "mfa"], "Account"),
    (["sharepoint access denied", "access denied"], "Account"),
    (["new employee onboarding"], "Account"),

    # Storage & Backup
    (["backup restore", "backup"], "Storage & Backup"),
    (["file recovery", "file recovery request"], "Storage & Backup"),
    (["disk space full", "disk space"], "Storage & Backup"),

    # General (catch-all for mobile/misc)
    (["mobile device sync"], "General"),
]

# Priority keywords (same as classification_chain.py)
PRIORITY_KEYWORDS = {
    "Critical": [
        "down", "outage", "crash", "emergency", "production down",
        "data loss", "security breach", "ransomware", "critical",
        "server down", "complete failure", "cannot access anything",
        "blue screen",
    ],
    "High": [
        "urgent", "asap", "broken", "not working", "blocked",
        "cannot login", "failed", "error", "multiple users affected",
        "high priority", "degraded performance", "not connecting",
        "credentials not working", "not responding", "access denied",
        "crashing",
    ],
    "Medium": [
        "slow", "intermittent", "sometimes", "issue with",
        "need help", "problem", "trouble", "glitch", "flickering",
        "freezing", "drops", "full", "stuck", "not detected",
        "sync", "expired", "installation", "setup", "reset",
        "recovery", "restore",
    ],
    "Low": [
        "question", "how to", "request", "information",
        "nice to have", "cosmetic", "minor", "enhancement",
        "replacement needed",
    ],
}


def classify_by_keywords(issue_text):
    """
    Classify a ticket issue using keyword matching.
    Returns (category, priority, confidence) or None if no match.
    """
    text_lower = issue_text.lower().strip()

    # Category classification
    category = None
    for keywords, cat in ISSUE_CATEGORY_RULES:
        for kw in keywords:
            if kw in text_lower:
                category = cat
                break
        if category:
            break

    if not category:
        return None

    # Priority classification
    priority_scores = {}
    for level, kws in PRIORITY_KEYWORDS.items():
        score = sum(1 for kw in kws if kw in text_lower)
        priority_scores[level] = score

    if max(priority_scores.values()) == 0:
        priority = "Medium"
    else:
        priority = max(priority_scores, key=priority_scores.get)

    return {
        "category": category,
        "priority": priority,
        "confidence": 0.95,  # high confidence for keyword match
        "all_categories": {category: 0.95},
        "model": "keyword-rules",
    }


def main():
    parser = argparse.ArgumentParser(description="Reclassify tickets using keyword rules")
    parser.add_argument("--dry-run", action="store_true", help="Preview changes without updating DB")
    parser.add_argument("--force", action="store_true", help="Re-process all tickets, even already classified ones")
    parser.add_argument("--limit", type=int, default=0, help="Limit number of tickets to process (0 = all)")
    args = parser.parse_args()

    # ── Connect to MongoDB ────────────────────────────────────────────────
    # Load env from backend/.env
    backend_env = os.path.join(APP_DIR, "..", "..", "backend", ".env")
    if os.path.exists(backend_env):
        load_dotenv(backend_env)
        print(f"[config] Loaded env from {backend_env}")
    else:
        load_dotenv()

    mongo_uri = os.getenv("MONGODB_URI", "mongodb://localhost:27017/it-support")
    print(f"[config] Connecting to MongoDB...")

    client = MongoClient(mongo_uri)

    # Detect database name from URI or default
    if "mongodb+srv" in mongo_uri or "mongodb://" in mongo_uri:
        db_name = client.get_default_database()
        if db_name is None:
            db = client["test"]
        else:
            db = db_name
    else:
        db = client["test"]

    tickets_col = db["tickets"]
    total_count = tickets_col.count_documents({})
    print(f"[db] Connected. Total tickets in DB: {total_count}")

    if total_count == 0:
        print("[db] No tickets found. Exiting.")
        return

    # ── Build query: only seeded tickets (TKT-00001 to TKT-01050) ────────
    # New tickets created via the API are already classified properly
    # through the normal /api/analyze flow — do NOT touch them.
    query = {
        "ticketId": {"$lte": "TKT-01050", "$gte": "TKT-00001"}
    }
    if not args.force:
        query["aiAnalysis.classifiedByDistilBERT"] = {"$ne": True}

    cursor = tickets_col.find(query).sort("createdAt", 1)
    if args.limit > 0:
        cursor = cursor.limit(args.limit)

    tickets = list(cursor)
    print(f"[db] Tickets to process: {len(tickets)}")

    if not tickets:
        print("[done] All tickets already classified. Use --force to re-process.")
        return

    # ── Optionally load DistilBERT as fallback for unknown issues ─────────
    classifier = None
    try:
        from chains.classification_chain import ClassificationChain
        print("\n[model] Loading DistilBERT classifier as fallback...")
        classifier = ClassificationChain()
        print()
    except Exception as e:
        print(f"\n[model] DistilBERT not available ({e}). Using keyword rules only.\n")

    # ── Process each ticket ───────────────────────────────────────────────
    updated = 0
    changed = 0
    errors = 0
    keyword_matches = 0
    model_matches = 0
    unmatched = 0

    for i, ticket in enumerate(tickets, 1):
        ticket_id = ticket.get("ticketId", "???")
        issue = ticket.get("issue", "")
        old_category = ticket.get("category", "General")
        old_priority = ticket.get("priority", "Medium")

        if not issue.strip():
            print(f"  [{i}/{len(tickets)}] {ticket_id} — SKIP (empty issue)")
            continue

        try:
            # Try keyword-based classification first
            result = classify_by_keywords(issue)
            if result:
                keyword_matches += 1
                method = "keyword"
            elif classifier:
                # Fallback to DistilBERT for issues not in keyword map
                result = classifier.classify(issue)
                model_matches += 1
                method = "distilbert"
            else:
                print(f"  [{i}/{len(tickets)}] {ticket_id} — SKIP (no keyword match, no model)")
                unmatched += 1
                continue

            new_category = result["category"]
            new_priority = result["priority"]
            confidence = result["confidence"]

            cat_changed = new_category != old_category
            pri_changed = new_priority != old_priority

            status = ""
            if cat_changed or pri_changed:
                changes = []
                if cat_changed:
                    changes.append(f"cat: {old_category} -> {new_category}")
                if pri_changed:
                    changes.append(f"pri: {old_priority} -> {new_priority}")
                status = f"UPDATED ({', '.join(changes)})"
                changed += 1
            else:
                status = "no change"

            print(f"  [{i}/{len(tickets)}] {ticket_id} | [{method}] \"{issue[:50]}\" | {status} | conf={confidence:.2f}")

            if not args.dry_run:
                update_fields = {
                    "category": new_category,
                    "priority": new_priority,
                    "aiAnalysis.classifiedByDistilBERT": True,
                    "aiAnalysis.distilbertCategory": new_category,
                    "aiAnalysis.distilbertPriority": new_priority,
                    "aiAnalysis.distilbertConfidence": confidence,
                    "aiAnalysis.allCategories": result.get("all_categories", {}),
                }
                tickets_col.update_one(
                    {"_id": ticket["_id"]},
                    {"$set": update_fields},
                )
                updated += 1

        except Exception as e:
            print(f"  [{i}/{len(tickets)}] {ticket_id} — ERROR: {e}")
            errors += 1

    # ── Summary ───────────────────────────────────────────────────────────
    print(f"\n{'='*60}")
    print(f"  RECLASSIFICATION COMPLETE {'(DRY RUN)' if args.dry_run else ''}")
    print(f"{'='*60}")
    print(f"  Total processed:    {len(tickets)}")
    print(f"  Keyword matches:    {keyword_matches}")
    print(f"  Model fallbacks:    {model_matches}")
    print(f"  Unmatched/skipped:  {unmatched}")
    print(f"  Categories changed: {changed}")
    print(f"  DB updates written: {updated}")
    print(f"  Errors:             {errors}")
    print(f"{'='*60}")

    if args.dry_run:
        print("\n  This was a dry run. No changes were written to the database.")
        print("  Run without --dry-run to apply changes.")

    client.close()


if __name__ == "__main__":
    main()
