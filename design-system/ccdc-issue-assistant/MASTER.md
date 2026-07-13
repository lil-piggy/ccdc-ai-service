# Design System Master File

> **LOGIC:** When building a specific page, first check `design-system/pages/[page-name].md`.
> If that file exists, its rules **override** this Master file.
> If not, strictly follow the rules below.

---

**Project:** CCDC Issue Assistant
**Updated:** 2026-07-13
**Category:** Fintech / Bond Issuance / Enterprise SaaS

---

## Global Rules

### Design Direction

- **Mode:** Light mode primary
- **Style:** Minimalism & Swiss Style
- **Personality:** Professional, authoritative, trustworthy, institutional
- **Visual language:** Clean geometry, generous whitespace, subtle depth, restrained color
- **No decorative gradients, neon glows, or playful animations**

### Color Palette

| Role | Hex | CSS Variable | Usage |
|------|-----|--------------|-------|
| Primary | `#0A2540` | `--color-primary` | Header, primary buttons, active states |
| Primary Hover | `#143A5E` | `--color-primary-hover` | Primary button hover |
| Accent | `#C89B3C` | `--color-accent` | Gold highlights, active indicators, trust marks |
| Accent Hover | `#B88A2D` | `--color-accent-hover` | Accent hover states |
| Background | `#F4F6F8` | `--color-background` | App background |
| Surface | `#FFFFFF` | `--color-surface` | Cards, sidebar, panels |
| Surface Elevated | `#FAFBFC` | `--color-surface-elevated` | Subtle card backgrounds, drop zones |
| Border | `#DEE2E7` | `--color-border` | Dividers, input borders, card borders |
| Border Hover | `#C8D0D9` | `--color-border-hover` | Hover borders |
| Text Primary | `#0F172A` | `--color-text-primary` | Headings, primary text |
| Text Secondary | `#5A677A` | `--color-text-secondary` | Labels, descriptions |
| Text Muted | `#8A96A8` | `--color-text-muted` | Placeholders, disabled, hints |
| Success | `#0D7A5F` | `--color-success` | Pass / success states |
| Warning | `#B76E00` | `--color-warning` | Risk / warning states |
| Danger | `#C53030` | `--color-danger` | Fail / error / destructive actions |
| Info | `#2563EB` | `--color-info` | Processing / info states |

**Color Notes:** Deep navy conveys institutional authority; gold accent signals premium financial services. Avoid bright cyan, magenta, or neon effects.

### Typography

- **Heading Font:** IBM Plex Sans
- **Body Font:** IBM Plex Sans
- **Mono Font:** IBM Plex Mono or Share Tech Mono for data/code
- **Mood:** financial, trustworthy, professional, corporate, banking, serious
- **Google Fonts:** [IBM Plex Sans](https://fonts.google.com/share?selection.family=IBM+Plex+Sans:wght@300;400;500;600;700)

**Type Scale:**
| Token | Size | Weight | Usage |
|-------|------|--------|-------|
| display | 28px | 600 | Page titles |
| heading | 22px | 600 | Section titles |
| subheading | 16px | 600 | Card titles |
| body | 14px | 400 | Body text |
| label | 12px | 500 | Labels, badges |
| caption | 11px | 500 | Timestamps, metadata |

### Spacing Variables

| Token | Value | Usage |
|-------|-------|-------|
| `--space-xs` | `4px` | Tight gaps |
| `--space-sm` | `8px` | Icon gaps |
| `--space-md` | `12px` | Inline spacing |
| `--space-lg` | `16px` | Standard padding |
| `--space-xl` | `20px` | Card padding |
| `--space-2xl` | `24px` | Section gaps |
| `--space-3xl` | `32px` | Large section margins |

### Shadow Depths

| Level | Value | Usage |
|-------|-------|-------|
| `--shadow-sm` | `0 1px 2px rgba(10, 37, 64, 0.04)` | Subtle lift |
| `--shadow-md` | `0 2px 8px rgba(10, 37, 64, 0.06)` | Cards, buttons |
| `--shadow-lg` | `0 4px 16px rgba(10, 37, 64, 0.08)` | Modals, dropdowns |
| `--shadow-xl` | `0 8px 24px rgba(10, 37, 64, 0.12)` | Overlays, drawers |

### Border Radius

| Token | Value | Usage |
|-------|-------|-------|
| `--radius-sm` | `6px` | Small buttons, tags |
| `--radius-md` | `8px` | Buttons, inputs |
| `--radius-lg` | `10px` | Cards, panels |
| `--radius-xl` | `12px` | Modals, large cards |

---

## Component Specs

### Buttons

```css
/* Primary Button */
.btn-primary {
  background: #0A2540;
  color: #FFFFFF;
  padding: 10px 20px;
  border-radius: 8px;
  font-weight: 600;
  font-size: 13px;
  transition: all 0.2s ease;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.btn-primary:hover {
  background: #143A5E;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(10, 37, 64, 0.2);
}
.btn-primary:active {
  transform: translateY(0);
}

/* Secondary Button */
.btn-secondary {
  background: transparent;
  color: #5A677A;
  border: 1px solid #DEE2E7;
  padding: 10px 20px;
  border-radius: 8px;
  font-weight: 500;
  transition: all 0.2s ease;
}
.btn-secondary:hover {
  border-color: #0A2540;
  color: #0A2540;
  background: rgba(10, 37, 64, 0.04);
}

/* Ghost Button */
.btn-ghost {
  background: transparent;
  color: #5A677A;
  border: none;
  padding: 8px 12px;
  border-radius: 6px;
}
.btn-ghost:hover {
  background: rgba(10, 37, 64, 0.04);
  color: #0F172A;
}
```

### Cards

```css
.card {
  background: #FFFFFF;
  border: 1px solid #DEE2E7;
  border-radius: 10px;
  padding: 20px;
  box-shadow: 0 1px 3px rgba(10, 37, 64, 0.04);
  transition: box-shadow 0.2s ease;
}
.card:hover {
  box-shadow: 0 4px 12px rgba(10, 37, 64, 0.08);
}
```

### Inputs

```css
.input {
  background: #FFFFFF;
  border: 1px solid #DEE2E7;
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 14px;
  color: #0F172A;
  transition: all 0.15s ease;
}
.input:focus {
  outline: none;
  border-color: #0A2540;
  box-shadow: 0 0 0 3px rgba(10, 37, 64, 0.08);
}
.input::placeholder {
  color: #8A96A8;
}
```

### Status Badges

```css
.badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.badge-success { background: rgba(13, 122, 95, 0.1); color: #0D7A5F; }
.badge-warning { background: rgba(183, 110, 0, 0.1); color: #B76E00; }
.badge-danger { background: rgba(197, 48, 48, 0.1); color: #C53030; }
.badge-info { background: rgba(37, 99, 235, 0.1); color: #2563EB; }
```

---

## Style Guidelines

**Style:** Minimalism & Swiss Style

**Keywords:** Clean, simple, spacious, functional, white space, high contrast, geometric, sans-serif, grid-based, essential

**Key Effects:**
- Subtle hover states (150–250ms)
- Smooth transitions
- Clear type hierarchy
- Restrained shadows
- No neon glows or disco animations

### Page Pattern

**Pattern Name:** Institutional Workbench

- **Information Density:** Medium-high; prioritize scanability of financial data
- **Navigation:** Persistent sidebar with clear hierarchy
- **Content Area:** Generous padding, card-based organization
- **Feedback:** Immediate, clear status indicators

---

## Anti-Patterns (Do NOT Use)

- ❌ **Emojis as icons** — Use SVG icons (Lucide/Heroicons style)
- ❌ **Neon / cyan / magenta glows** — Institutional products avoid these
- ❌ **Playful animations** — No bouncing logos, disco effects, or rotating sparkles
- ❌ **Decorative gradients on backgrounds** — Keep surfaces flat and clean
- ❌ **Low contrast text** — Maintain 4.5:1 minimum contrast ratio
- ❌ **Instant state changes** — Always use transitions (150–300ms)
- ❌ **Invisible focus states** — Focus states must be visible for a11y

### Additional Forbidden Patterns

- ❌ **Emoji in buttons, labels, or navigation**
- ❌ **Mixing filled and outline icon styles**
- ❌ **Raw hex values in components** — Use CSS variables
- ❌ **Decorative-only animation** — Every motion must convey meaning

---

## Pre-Delivery Checklist

Before delivering any UI code, verify:

- [ ] No emojis used as icons (use SVG instead)
- [ ] All icons from consistent icon set (Lucide/Heroicons style, 1.5–2px stroke)
- [ ] `cursor-pointer` on all clickable elements
- [ ] Hover states with smooth transitions (150–300ms)
- [ ] Light mode: text contrast 4.5:1 minimum
- [ ] Focus states visible for keyboard navigation
- [ ] `prefers-reduced-motion` respected
- [ ] Responsive: 375px, 768px, 1024px, 1440px
- [ ] No content hidden behind fixed navbars
- [ ] No horizontal scroll on mobile
- [ ] Touch targets >= 44px
