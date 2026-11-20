# Claude Code Constraints — E-Balik (UMak Lost & Found)

## 1. Token Efficiency (Non-Negotiable)
- **Surgical edits only.** Use search-and-replace or targeted diffs. Never rewrite entire files.
- **Grep before reading.** Before opening any file, grep for the exact symbol/section you need. Use line-range reads, not whole-file reads.
- **Never guess.** Never assume API endpoints, props, or DB columns. Verify with grep or a targeted file read first.
- **No filler.** Skip pleasantries, prompt restatements, and explanation paragraphs. Deliver code directly.
- **Complete code only.** No `// rest of code` placeholders. Every implementation must be production-ready.

## 2. Project Context — Read Only What You Need
**Do NOT read PROJECT_CONTEXT.md or database_schema.sql in full.** They are very large. Instead:
- To find architecture, routing, or endpoints → `grep` PROJECT_CONTEXT.md for the specific section heading.
- To find a DB table → use the Supabase MCP tool to inspect the live table directly, or grep database_schema.sql for the table name only.
- To find styling tokens → grep `Users/Frontend/src/styles/theme.css` for the token name.
- Read a full file **only** if the task touches the entire file's domain and grep is insufficient.

**Key facts (no file read needed):**
- Stack: React 18 + TypeScript + Vite + Tailwind CSS v4 + Radix UI (frontend); Python + Flask (backend); Supabase PostgreSQL + Storage.
- Design: "Gallery Glass" — Navy `#1f3160`, Gold `#d1a153`, frost/iris/mint accents. Never flat or generic.
- Navigation: page-state in `Users/Frontend/src/app/App.tsx`. Not React Router.
- Structure: `Users/` and `Admin/` each have `Frontend/` and `Backend/`. One folder per page. Shared Flask utilities in `Server/`.
- Images: buckets `missing-item-images` and `found-item-images`. Preserve `File` objects in multipart uploads.
- Never expose reporter email or campus ID in public listings.
- No mock data for real workflows.

## 3. Supabase MCP (Direct DB Access)
You have read access to the live Supabase database via MCP.
- Use it to inspect real column types, RLS policies, and table structure **instead of reading schema files**.
- Query only the tables relevant to the current task.
- Never use it to infer the full schema — one table at a time.

## 4. Audit Log — Keep It Short
Append to `Audits/YYYY-MM-DD_Audit.md` (local date) after every interaction.

**Format — max 15 lines per entry:**
```
## [5-word title of what changed]
**Changed:** one bullet per file or logical group — filename + one-line description
**DB:** migration filename, or "None"
**Status:** "Build passes" / "X tests pass", or nothing
```
- No prompt restatement. No paragraph explanations. No verification prose.
- Group related files into one bullet (e.g. "found_item routes + missing_item routes — date validation").
- Append only; never rewrite earlier entries.

## 5. Environment Files
All env files live in `Environment_Configs/`.
- Backend: `Environment_Configs/backend/.env` (loaded by `Server/config.py`)
- Frontend: `Environment_Configs/frontend/.env.local` (loaded via Vite `envDir`)
- Never create `.env` files inside `Server/` or the frontend folders.

## 6. Dev Commands
- All: `npm run dev` · Frontend: `npm run dev:frontend` · Backend: `npm run dev:backend` · Admin: `npm run dev:admin`

## 7. Documentation Tasks
If the request is a paper, report, manual, or spreadsheet: read `docs/DOCUMENTATION_GUIDE.md` first. Do not edit code during documentation tasks.