# SystematicAI — Systematic Review Platform

A full-featured systematic review and meta-analysis platform, built as a Rayyan.AI-style collaborative tool.

## Features

- **Multi-user accounts** with roles: Owner, Admin, Reviewer, Highlighter, Viewer
- **Blinded screening** — reviewers can't see each other's decisions (configurable per review)
- **AI duplicate detection** — title similarity (Levenshtein + Jaccard), DOI, and PMID matching
- **Abstract screening** with keyboard shortcuts (I/E/M keys)
- **Full-text screening** with PDF link support
- **Conflict detection & resolution** — automatic flagging when reviewers disagree
- **Data extraction** with customizable fields (text, textarea, number, select, boolean, date)
- **Progress bars** throughout with real-time team stats
- **Gamification** — points, streaks, 11 badge types, podium leaderboard
- **Import** from RIS, BibTeX, CSV (PubMed, Embase, etc.)
- **Real-time collaboration** via Socket.io
- **Notifications** for invites, conflicts, badges

## Quick Start

```bash
# Install dependencies
cd backend && npm install && cd ..
cd frontend && npm install && cd ..

# Start both servers
bash start.sh
```

Open http://localhost:5173

## Architecture

- **Frontend**: React 18 + TypeScript + Vite + Tailwind CSS + Zustand + React Query
- **Backend**: Express + TypeScript + Socket.io
- **Database**: SQLite (via better-sqlite3) — no setup required, data stored in `data/sra.db`

## Screening Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `I` | Include |
| `E` | Exclude (opens reason modal) |
| `M` | Maybe |
| `←` / `→` | Navigate articles |

## Roles

| Role | Permissions |
|------|-------------|
| Owner | Full access, delete review |
| Admin | Manage articles, team, settings |
| Reviewer | Screen, extract data |
| Highlighter | Highlight/comment only |
| Viewer | Read-only |
