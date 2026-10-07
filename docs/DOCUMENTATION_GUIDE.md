# E-Balik Documentation Guide (for Claude)

Read this whole file before writing or editing any paper, report, manual, proposal, slide deck or spreadsheet for E-Balik. It exists to keep documents accurate and cheap to produce.

## 1. Scope
- Documents only: papers, chapters, system documentation, user and admin manuals, test reports, presentations, spreadsheets, summaries.
- Do not edit source code, the database or `Server/manual_migrations/` in a documentation task. If the code and the docs disagree, report it and let the user decide.

## 2. Token-efficient workflow
1. Identify the document type and its sections. If the user gave a template or school format, follow it exactly; otherwise propose a short outline and wait for a yes.
2. Read only what the section needs, never the whole repo. Use Grep on headings first, then Read a line range.
3. Draft one section or chapter at a time. Save after each, so work is never lost and revisions touch only one part.
4. Revise with targeted edits. Do not regenerate a whole document to change a paragraph.
5. Do not paste whole documents back in chat. Reply with what changed and what is next.

## 3. Source of truth (read on demand)
| Need | Read |
|---|---|
| Purpose, features, architecture, endpoints, matching logic, theme | `PROJECT_CONTEXT.md` (grep `^## ` for its sections) |
| Tables, columns, constraints | `Server/database_schema.sql` (also `docs/DATABASE_SCHEMA.txt`) |
| Smart Tags behaviour | `SMART_TAGS_GUIDE.md` |
| Hosting, environments, migrations order | `DEPLOYMENT_GUIDE.md`, `Server/DATABASE_SETUP.md` |
| Admin MFA | `docs/ADMIN_AUTHENTICATOR_MFA_GUIDE.md` |
| Claiming and admin roles rationale | `docs/CLAIMING_AND_ADMIN_ROLE_RECOMMENDATIONS.md` |
| Existing presentation outline | `docs/SYSTEM_PRESENTATION_GUIDE.txt` |
| What changed and when, with test results | `Audits/YYYY-MM-DD_Audit.md` |
| Open work | `docs/IMPLEMENTATION_CHECKLIST.md`, "Known Gaps" in `PROJECT_CONTEXT.md` |
| Third-party credits | `docs/ATTRIBUTIONS.md` |

`PROJECT_CONTEXT.md` can lag behind the code. For any claim that matters (an endpoint, a status value, a rule), confirm it in the code or the newest audit entry.

## 4. Accuracy rules
- State only what the files or the user support. Never invent features, statistics, survey results, user counts, test counts, dates, citations or quotes.
- Anything unconfirmed or untested is written as "to be confirmed" or listed as a limitation. The audits record what was not tested; carry that honesty into papers.
- Cite the source file or audit date in a short note for non-obvious technical claims, so the user can check them.
- Citations and references: use only sources the user provides or that were actually opened. Never fabricate a reference.

## 5. Privacy and security
- Never put secrets in a document: keys, tokens, passwords, `.env` values, service keys, real PINs, JWTs.
- Never include real personal data: campus IDs, emails, names of real users, screenshots showing them. Use clearly marked sample values.
- Describe security controls (approval gates, rate limits, hashing, privacy rules) at design level, not as exploitable detail.

## 6. Writing standards
- Language: clear, formal, plain English. Tagalog only when the user asks.
- Name the system "E-Balik" and the institution "University of Makati (UMak)".
- Consistent terms: Missing item report, Found item report, Claim, Handover PIN, Smart Tag, Auction. Do not swap synonyms inside one document.
- Prefer short paragraphs, numbered headings and tables for comparisons. No filler, no marketing tone, no emojis.
- Diagrams: describe them or build them as an image or table the user can paste; mark placeholders as `[Figure N: description]`.

## 7. Output and format
- Default location for files: `docs/papers/` (create it when first needed). Use the `docx`, `pptx` or `xlsx` skill for Office formats, `pdf` only when asked.
- If a Google Workspace connector is enabled in the session, create and edit the Google Doc or Sheet directly and give the user the link. Otherwise save a file and say where it is.
- Name files `<Topic>_<Version>.<ext>` (for example `System_Documentation_v1.docx`).
- When a page limit, font, margin, citation style (APA, IEEE) or chapter structure applies, record it in section 9 so it is asked only once.

## 8. Audit log (required by `CLAUDE.md`)
Append an entry to today's `Audits/YYYY-MM-DD_Audit.md` for each documentation task: Prompt Audit, Edit Audit (files or Google Docs created or changed, which sections), Database Audit ("None"). Append only.

## 9. Paper requirements (fill in once, then keep updated)
- Document types needed: _not set_
- Citation style: _not set_
- Required chapter/section structure: _not set_
- Font, spacing, margins, page limit: _not set_
- Adviser or panel notes: _not set_
- Names to appear on the title page: _not set_
