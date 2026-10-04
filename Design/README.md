# Design

Design resources kept separate from the application code. Nothing here is imported by the frontend, admin, or backend builds.

- `skills/<tool>/`: the design skill pack (ui-ux-pro-max, brand, design, design-system, slides, ui-styling, banner-design) as installed for each AI coding tool. These tools only load the pack from their hidden folder at the repository root, so copy a tool's folder back to the root (for example `skills/.cursor` → `.cursor`) to re-enable it there. Claude Code's copy stays in the root `.claude/skills`.
- `default_shadcn_theme.css`: reference shadcn theme tokens (the live theme is `Users/Frontend/src/styles/theme.css`).
- `Guidelines.md`: Figma Make guidelines template.
