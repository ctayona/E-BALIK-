# Claude Code Constraints & System Context

You are working within the E-Balik Project (University of Makati lost-and-found system). 
The rules below exist **ONLY** to maximize token efficiency and prevent token waste. They are **not** quality limiters. You must maintain the highest standard of code quality, architecture, and problem-solving at all times.

## 1. Token Efficiency (Zero Quality Compromise)
- **High-Signal Output Only:** Skip conversational filler, pleasantries, and restatements of the user's prompt. Deliver high-quality, direct engineering solutions immediately.
- **Surgical Edits:** Never output entire file contents in your responses when modifying code. ALWAYS use targeted search-and-replace tools or diff-based edits to save tokens.
- **Zero-Guessing Policy:** To prevent hallucination loops that burn tokens, NEVER guess API endpoints, component props, or database tables. Always use file reading and search tools to fetch the exact context before writing code.
- **Provide Complete Logic:** "Concise" means no filler words, it does NOT mean skipping code. When you write code, provide fully complete, robust, and production-ready implementations without placeholder comments like `// rest of code`.

## 2. On-Demand Project Context
To save tokens on every prompt, the full project context is not dumped here. When you need deep architectural context, **you MUST read the following files:**
- **`PROJECT_CONTEXT.md`**: Contains the full architecture, frontend state/routing rules, backend endpoints, matching logic, and styling theme. **Read this for any feature work.**
- **`Server/database_schema.sql`**: The canonical and authoritative Supabase PostgreSQL schema. **Read this before any DB or backend changes.**
- **`docs/IMPLEMENTATION_CHECKLIST.md`**: Check this if tracking remaining tasks.

## 3. Core Tech Stack Constraints
- **Frontend:** React 18, TypeScript, Vite, Tailwind CSS v4, Radix UI.
- **Backend:** Python, Flask.
- **Database/Storage:** Supabase PostgreSQL and Supabase Storage.
- **Styling:** Adhere strictly to the UMak Navy (#1f3160) and Gold (#d1a153) theme. Use Tailwind and `Users/Frontend/src/styles/theme.css`. Avoid flat, generic designs.

## 4. Architectural Rules
- **Repository Structure:** `Users/` and `Admin/` each contain `Frontend/` and `Backend/`, with one folder per page on both sides (see "Repository Layout" in `PROJECT_CONTEXT.md`). Shared Flask core and services live in `Server/`. Put new code in the folder of the page that uses it.
- **No Mock Data:** The project uses an existing Supabase backend. Do not introduce mock data for core workflows.
- **Navigation:** The frontend currently relies on page state in `Users/Frontend/src/app/App.tsx`, not React Router.
- **Images:** Missing and Found items use Supabase storage buckets (`missing-item-images`, `found-item-images`). Preserve multipart `File` objects in form data uploads.
- **Security:** Do not expose sensitive user data (reporter email, campus ID) in public listings (e.g., Browse Items).

## 5. Dev Commands
- Start everything (Frontend, Backend, Admin): `npm run dev`
- Frontend only: `npm run dev:frontend`
- Backend only: `npm run dev:backend`
- Admin only: `npm run dev:admin`
