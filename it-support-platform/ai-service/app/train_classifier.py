"""
train_classifier.py
-------------------
Fine-tunes DistilBertForSequenceClassification on IT support ticket data.

Training data:
  - tickets_final.csv  (1350 tickets, 6 categories)
  - it_support_ticket.csv (25 tickets, adds Email & Account categories)

Unified label set:
  Network, Hardware, Software, Security, Cloud & Servers,
  Storage & Backup, Email, Account

Output:
  models/ticket-classifier/  (fine-tuned model + tokenizer + label map)

Usage:
    cd ai-service/app
    python train_classifier.py
    python train_classifier.py --epochs 5 --batch-size 16
"""

import os
import json
import argparse
import pandas as pd
import numpy as np
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report, accuracy_score

import torch
from torch.utils.data import Dataset, DataLoader
from transformers import (
    DistilBertTokenizer,
    DistilBertForSequenceClassification,
    get_linear_schedule_with_warmup,
)

# ── Config ────────────────────────────────────────────────────────────────────

MODEL_NAME = "distilbert-base-uncased"
OUTPUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models", "ticket-classifier")

# Unified category mapping: normalize CSV labels → training labels
CATEGORY_MAP = {
    # From tickets_final.csv
    "Cloud & Servers":       "Cloud & Servers",
    "Security & Access":     "Security",
    "Hardware":              "Hardware",
    "Network":               "Network",
    "Storage & Backup":      "Storage & Backup",
    "Software Applications": "Software",
    # From it_support_ticket.csv
    "Software":              "Software",
    "Email":                 "Email",
    "Account":               "Account",
}

# Final ordered label list
LABELS = [
    "Network",
    "Hardware",
    "Software",
    "Security",
    "Cloud & Servers",
    "Storage & Backup",
    "Email",
    "Account",
]


# ── Dataset ───────────────────────────────────────────────────────────────────

class TicketDataset(Dataset):
    def __init__(self, texts, labels, tokenizer, max_len=128):
        self.texts = texts
        self.labels = labels
        self.tokenizer = tokenizer
        self.max_len = max_len

    def __len__(self):
        return len(self.texts)

    def __getitem__(self, idx):
        encoding = self.tokenizer(
            self.texts[idx],
            max_length=self.max_len,
            padding="max_length",
            truncation=True,
            return_tensors="pt",
        )
        return {
            "input_ids": encoding["input_ids"].squeeze(),
            "attention_mask": encoding["attention_mask"].squeeze(),
            "labels": torch.tensor(self.labels[idx], dtype=torch.long),
        }


# ── Data loading ──────────────────────────────────────────────────────────────

def load_data():
    """Load and combine training data from CSV files."""
    app_dir = os.path.dirname(os.path.abspath(__file__))
    records = []

    # 1. tickets_final.csv (main dataset — 1350 rows)
    path1 = os.path.join(app_dir, "tickets_final.csv")
    if os.path.exists(path1):
        df = pd.read_csv(path1)
        for _, row in df.iterrows():
            issue = str(row.get("Issue_Description", "")).strip()
            cat = CATEGORY_MAP.get(row.get("Category", ""), None)
            if issue and cat:
                records.append({"text": issue, "label": cat})
        print(f"  Loaded {len(df)} from tickets_final.csv")

    # 2. it_support_ticket.csv (small dataset — adds Email & Account)
    path2 = os.path.join(app_dir, "it_support_ticket.csv")
    if os.path.exists(path2):
        df = pd.read_csv(path2)
        for _, row in df.iterrows():
            issue = str(row.get("issue", "")).strip()
            cat = CATEGORY_MAP.get(row.get("category", ""), None)
            if issue and cat:
                records.append({"text": issue, "label": cat})
        print(f"  Loaded {len(df)} from it_support_ticket.csv")

    # 3. tech_support_dataset.csv (extra data for Hardware, Network, Software, Account)
    path3 = os.path.join(app_dir, "..", "..", "data", "tech_support_dataset.csv")
    if os.path.exists(path3):
        df = pd.read_csv(path3)
        tech_map = {
            "Hardware": "Hardware",
            "Network": "Network",
            "Software": "Software",
            "Account": "Account",
            "Performance": "Software",  # performance issues are typically software
        }
        for _, row in df.iterrows():
            issue = str(row.get("Customer_Issue", "")).strip()
            cat = tech_map.get(row.get("Issue_Category", ""), None)
            if issue and cat and len(issue) > 10:
                records.append({"text": issue, "label": cat})
        print(f"  Loaded {len(df)} from tech_support_dataset.csv")

    df = pd.DataFrame(records)
    print(f"\n  Total training records: {len(df)}")
    print(f"  Label distribution:\n{df['label'].value_counts().to_string()}")
    return df


# ── Training ──────────────────────────────────────────────────────────────────

def train(epochs=4, batch_size=16, lr=2e-5, max_len=128):
    print("=" * 60)
    print("  DistilBERT Fine-Tuning for IT Ticket Classification")
    print("=" * 60)

    # Load data
    print("\n[1/5] Loading training data...")
    df = load_data()

    # Create label encoding
    label2id = {label: i for i, label in enumerate(LABELS)}
    id2label = {i: label for i, label in enumerate(LABELS)}

    # Filter out any labels not in our LABELS list
    df = df[df["label"].isin(LABELS)].reset_index(drop=True)

    # Encode labels
    df["label_id"] = df["label"].map(label2id)

    # Train/val split (stratified)
    train_texts, val_texts, train_labels, val_labels = train_test_split(
        df["text"].tolist(),
        df["label_id"].tolist(),
        test_size=0.15,
        random_state=42,
        stratify=df["label_id"].tolist(),
    )
    print(f"\n  Train: {len(train_texts)}, Validation: {len(val_texts)}")

    # Tokenizer
    print("\n[2/5] Loading DistilBERT tokenizer...")
    tokenizer = DistilBertTokenizer.from_pretrained(MODEL_NAME)

    train_dataset = TicketDataset(train_texts, train_labels, tokenizer, max_len)
    val_dataset = TicketDataset(val_texts, val_labels, tokenizer, max_len)

    train_loader = DataLoader(train_dataset, batch_size=batch_size, shuffle=True)
    val_loader = DataLoader(val_dataset, batch_size=batch_size)

    # Model
    print("[3/5] Loading DistilBERT model...")
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"  Device: {device}")

    model = DistilBertForSequenceClassification.from_pretrained(
        MODEL_NAME,
        num_labels=len(LABELS),
        id2label=id2label,
        label2id=label2id,
    )
    model.to(device)

    # Optimizer & scheduler
    optimizer = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=0.01)
    total_steps = len(train_loader) * epochs
    scheduler = get_linear_schedule_with_warmup(
        optimizer, num_warmup_steps=total_steps // 10, num_training_steps=total_steps
    )

    # Training loop
    print(f"\n[4/5] Training for {epochs} epochs...")
    best_val_acc = 0
    best_epoch = 0

    for epoch in range(epochs):
        # ── Train ──
        model.train()
        total_loss = 0
        correct = 0
        total = 0

        for batch in train_loader:
            input_ids = batch["input_ids"].to(device)
            attention_mask = batch["attention_mask"].to(device)
            labels = batch["labels"].to(device)

            outputs = model(input_ids=input_ids, attention_mask=attention_mask, labels=labels)
            loss = outputs.loss

            total_loss += loss.item()
            preds = torch.argmax(outputs.logits, dim=1)
            correct += (preds == labels).sum().item()
            total += labels.size(0)

            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            scheduler.step()
            optimizer.zero_grad()

        train_acc = correct / total
        avg_loss = total_loss / len(train_loader)

        # ── Validate ──
        model.eval()
        val_preds = []
        val_true = []

        with torch.no_grad():
            for batch in val_loader:
                input_ids = batch["input_ids"].to(device)
                attention_mask = batch["attention_mask"].to(device)
                labels = batch["labels"].to(device)

                outputs = model(input_ids=input_ids, attention_mask=attention_mask)
                preds = torch.argmax(outputs.logits, dim=1)
                val_preds.extend(preds.cpu().numpy())
                val_true.extend(labels.cpu().numpy())

        val_acc = accuracy_score(val_true, val_preds)

        print(f"  Epoch {epoch+1}/{epochs} | Loss: {avg_loss:.4f} | Train Acc: {train_acc:.3f} | Val Acc: {val_acc:.3f}")

        if val_acc > best_val_acc:
            best_val_acc = val_acc
            best_epoch = epoch + 1

    # ── Final classification report ──
    print(f"\n  Best validation accuracy: {best_val_acc:.3f} (epoch {best_epoch})")
    print(f"\n  Classification Report (validation set):")
    target_names = [id2label[i] for i in sorted(set(val_true))]
    print(classification_report(val_true, val_preds, target_names=target_names))

    # ── Save model ──
    print(f"[5/5] Saving model to {OUTPUT_DIR}...")
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    model.save_pretrained(OUTPUT_DIR)
    tokenizer.save_pretrained(OUTPUT_DIR)

    # Save label map as JSON for easy loading
    label_map = {"label2id": label2id, "id2label": id2label, "labels": LABELS}
    with open(os.path.join(OUTPUT_DIR, "label_map.json"), "w") as f:
        json.dump(label_map, f, indent=2)

    print(f"\n{'='*60}")
    print(f"  TRAINING COMPLETE")
    print(f"  Model saved to: {OUTPUT_DIR}")
    print(f"  Labels: {LABELS}")
    print(f"  Best Val Accuracy: {best_val_acc:.1%}")
    print(f"{'='*60}")
    print(f"\n  Next steps:")
    print(f"  1. The ClassificationChain will auto-detect this model on next startup")
    print(f"  2. Run: python reclassify_tickets.py --force")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--epochs", type=int, default=4)
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--lr", type=float, default=2e-5)
    parser.add_argument("--max-len", type=int, default=128)
    args = parser.parse_args()

    train(epochs=args.epochs, batch_size=args.batch_size, lr=args.lr, max_len=args.max_len)
