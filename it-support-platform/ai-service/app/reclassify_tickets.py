"""
reclassify_tickets.py
---------------------
Standalone script to reclassify all seeded tickets in MongoDB
using the DistilBERT ClassificationChain.

- Connects directly to MongoDB
- Fetches tickets that haven't been reclassified yet
- Runs DistilBERT zero-shot classification on each ticket's issue text
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

from chains.classification_chain import ClassificationChain


def main():
    parser = argparse.ArgumentParser(description="Reclassify tickets using DistilBERT")
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
        # If no DB in URI, use default
        db_name = client.get_default_database()
        if db_name is None:
            db = client["test"]
        else:
            db = db_name
    else:
        db = client["test"]

    # Try to find the tickets collection
    tickets_col = db["tickets"]
    total_count = tickets_col.count_documents({})
    print(f"[db] Connected. Total tickets in DB: {total_count}")

    if total_count == 0:
        print("[db] No tickets found. Exiting.")
        return

    # ── Build query: skip already-processed tickets ───────────────────────
    query = {}
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

    # ── Load DistilBERT classifier ────────────────────────────────────────
    print()
    classifier = ClassificationChain()
    print()

    # ── Process each ticket ───────────────────────────────────────────────
    updated = 0
    changed = 0
    errors = 0

    for i, ticket in enumerate(tickets, 1):
        ticket_id = ticket.get("ticketId", "???")
        issue = ticket.get("issue", "")
        old_category = ticket.get("category", "General")
        old_priority = ticket.get("priority", "Medium")

        if not issue.strip():
            print(f"  [{i}/{len(tickets)}] {ticket_id} — SKIP (empty issue)")
            continue

        try:
            result = classifier.classify(issue)
            new_category = result["category"]
            new_priority = result["priority"]
            confidence = result["confidence"]

            cat_changed = new_category != old_category
            pri_changed = new_priority != old_priority

            status = ""
            if cat_changed or pri_changed:
                changes = []
                if cat_changed:
                    changes.append(f"category: {old_category} -> {new_category}")
                if pri_changed:
                    changes.append(f"priority: {old_priority} -> {new_priority}")
                status = f"UPDATED ({', '.join(changes)})"
                changed += 1
            else:
                status = "no change"

            print(f"  [{i}/{len(tickets)}] {ticket_id} | \"{issue[:50]}\" | {status} | conf={confidence:.2f}")

            if not args.dry_run:
                # Update the ticket in MongoDB
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
    print(f"  Total processed:  {len(tickets)}")
    print(f"  Categories changed: {changed}")
    print(f"  DB updates written: {updated}")
    print(f"  Errors:           {errors}")
    print(f"{'='*60}")

    if args.dry_run:
        print("\n  This was a dry run. No changes were written to the database.")
        print("  Run without --dry-run to apply changes.")

    client.close()


if __name__ == "__main__":
    main()
