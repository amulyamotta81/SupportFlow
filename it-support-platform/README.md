# AI-Powered IT Infrastructure Support Platform

A full-stack IT support ticketing system with AI-driven first-layer support, RAG-based ticket classification, and intelligent agent routing.

## Tech Stack

- **Frontend:** React + Tailwind CSS
- **Backend:** Node.js + Express
- **Database:** MongoDB
- **AI Service:** Python FastAPI + FAISS (RAG for ticket classification)

## Project Structure

```
it-support-platform/
├── frontend/       # React + Tailwind
├── backend/        # Node.js + Express API
├── ai-service/     # Python FastAPI AI/RAG service
├── data/           # Sample datasets (1000+ tickets)
└── README.md
```

## Quick Start

### 1. MongoDB
Ensure MongoDB is running locally or set `MONGODB_URI` in backend/.env

### 2. Backend
```bash
cd backend
npm install
npm run seed    # Seeds 1000+ tickets and users
npm run dev
```

### 3. AI Service
```bash
cd ai-service
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```
*Note: Without FAISS/sentence-transformers, the AI uses a keyword-based fallback that still provides classification and suggestions.*

### 3b. Sync Knowledge Base (Dynamic RAG)
After seeding, sync resolved tickets to the AI for dynamic suggestions:
```bash
cd backend
npm run sync-ai
```
*Run this periodically or when new tickets are resolved to keep AI suggestions up to date.*

### 4. Frontend
```bash
cd frontend
npm install
npm run dev
```

### Default Login Credentials
- **Employee:** employee@test.com / password123
- **Agent:** agent@test.com / password123
- **Admin:** admin@test.com / password123

## Features

- Role-based auth (Employee, Agent, Admin)
- AI Chatbot with RAG for first-line support
- Ticket creation, classification, and routing
- Ticket Intelligence View with AI analysis
- Agent Dashboard with SLA tracking
- Admin Panel with analytics and knowledge base management


for kb building 
-- python build_kb.py --csv file1.csv file2.csv
then start ai service using uvicorn command.
