# Page Override: Issue Assistant 发行智能助手

> Overrides `design-system/ccdc-issue-assistant/MASTER.md` for the Issue Assistant panel.

## Theme Decision

- **Mode**: Light mode primary (matches existing screenshot and user expectation)
- **Rationale**: Financial workbench; users spend long hours reading documents and tables. Light mode reduces eye strain for dense text and printed reports.

## Color Palette (Light)

| Role | Hex | CSS Variable | Usage |
|------|-----|--------------|-------|
| Primary | `#0A2540` | `--ia-primary` | Header, primary buttons, active nav indicator |
| Primary Hover | `#143A5E` | `--ia-primary-hover` | Button hover |
| Accent | `#C89B3C` | `--ia-accent` | Gold accent, active states, highlights |
| Accent Hover | `#B88A2D` | `--ia-accent-hover` | Link hover, icon hover |
| Background | `#F4F6F8` | `--ia-bg` | Panel background |
| Surface | `#FFFFFF` | `--ia-surface` | Cards, sidebar |
| Surface Elevated | `#FAFBFC` | `--ia-surface-elevated` | Subtle card backgrounds |
| Border | `#DEE2E7` | `--ia-border` | Card borders, dividers |
| Text Primary | `#0F172A` | `--ia-text-primary` | Headings, primary text |
| Text Secondary | `#5A677A` | `--ia-text-secondary` | Labels, descriptions |
| Text Muted | `#8A96A8` | `--ia-text-muted` | Placeholders, disabled |
| Success | `#0D7A5F` | `--ia-success` | Pass / success states |
| Warning | `#B76E00` | `--ia-warning` | Risk / warning states |
| Danger | `#C53030` | `--ia-danger` | Fail / error states |
| Info | `#2563EB` | `--ia-info` | Processing / info states |

## Typography

- **Font Family**: IBM Plex Sans (300, 400, 500, 600, 700)
- **Headings**: 600 weight, tight tracking
- **Body**: 400 weight, 1.5 line-height
- **Data/Numbers**: Tabular figures where available

## Layout

- **Sidebar width**: 240px
- **Content max-width**: 1100px centered
- **Spacing scale**: 4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 48px
- **Card radius**: 12px
- **Button radius**: 8px
- **Input radius**: 8px

## Components

### Header
- Dark navy background (`--ia-primary`)
- White brand text with gold accent
- Height 56px
- Subtle bottom border

### Sidebar
- White surface
- 1px right border
- Group labels in uppercase, muted, 10px, letter-spacing 1px
- Menu item: 12px padding, 8px gap, rounded 8px
- Active item: navy left border 3px + light navy background
- Hover: subtle gray background

### Cards
- White background
- 1px border
- 12px radius
- 24px padding
- Subtle shadow: `0 1px 3px rgba(10, 37, 64, 0.06)`
- Section title: 14px, 600 weight, navy

### File Drop Zone
- Dashed border 2px `--ia-border`
- Rounded 10px
- Large upload icon (SVG)
- Hover: border changes to accent gold, background subtle gold tint
- Drag over: solid border + stronger tint

### Buttons
- Primary: navy background, white text, 8px radius, 12px 24px padding
- Hover: primary-hover background, slight lift shadow
- Disabled: 50% opacity, not-allowed cursor
- Loading state: spinner inside button

### Form Inputs
- White background
- 1px border `--ia-border`
- 8px radius
- Focus: navy border + 3px navy ring at 15% opacity
- Labels: 12px, secondary text, 6px bottom margin

### Result Empty State
- Centered
- Large illustration icon (SVG, muted)
- Title + helper text
- No plain "results will show here"

### Status Badges
- `pending`: amber
- `completed`: green
- `failed`: red
- `processing`: blue
- Pill shape, 12px font

## Icons

- **No emojis** anywhere in the Issue Assistant panel
- Use inline SVG icons (Lucide-style 24px stroke icons)
- Consistent 1.5px stroke width
- Icon color matches text color or accent

## Accessibility

- All interactive elements have visible focus rings
- Touch targets >= 44px
- Color not used alone for status (icons + text)
- Reduced motion respected

## Anti-Patterns (Avoid)

- Emojis as icons
- Bright neon gradients
- Instant state changes
- Low contrast text
- Layout-shifting hovers
