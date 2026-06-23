# HIUSA Design Guide

This document defines the visual direction for the HIUSA system so the login page, dashboard, and future modules feel like one product. Use this as the reference when separating the current login page into components and when building the admin dashboard.

## Brand Foundation

HIUSA uses a sharp faceted blue logo with deep slate shadows. The interface should feel modern, clean, secure, and school/organization-friendly. Avoid playful decorative patterns, heavy gradients everywhere, oversized marketing sections, and cluttered card layouts.

The product should look like an admin system people can use every day: calm, readable, fast to scan, and confident.

## Logo

Primary logo asset:

`client/src/assets/Hiusa Logo.png`

Usage rules:

- Use the actual logo image instead of recreating the mark with text or shapes.
- Give the logo breathing room. Minimum clear space should be close to the width of the triangle tip around all sides.
- On dark backgrounds, place the logo inside a white or very light container if the edges need contrast.
- On light backgrounds, the logo can sit directly on white or soft blue surfaces.
- Pair the logo with the word `HIUSA` in uppercase Poppins ExtraBold or Black.
- Do not stretch, recolor, rotate, blur, or place the logo on busy imagery.

Recommended sizes:

- Auth screens: 44px mark height.
- Dashboard sidebar: 36px to 40px mark height.
- Top navigation mobile: 34px to 38px mark height.
- Favicon/app icon: use the mark only.

## Color System

The palette is based on the logo: electric blue, cyan highlights, deep slate, and clean white surfaces.

### Primary Colors

- Primary Blue: `#0B8ED0`
  Main buttons, active navigation, important links, selected states.
- Primary Blue Hover: `#0878B7`
  Hover state for primary buttons and links.
- Electric Cyan: `#16C7F3`
  Focus rings, small highlights, chart accents, notification indicators.
- Deep Navy: `#0B1831`
  Sidebar background, auth brand panel, strong headings on dark sections.
- Dashboard Navy: `#0F2F62`
  Secondary dark panels and header accents.

### Neutral Colors

- Page Background: `#EEF6FB`
  Main app background. Soft enough to separate white cards without looking gray.
- Surface White: `#FFFFFF`
  Cards, forms, modals, tables, and dashboard panels.
- Border: `#DDE7EF`
  Default dividers, input borders, card borders.
- Text Strong: `#0F172A`
  Page titles, table values, labels.
- Text Muted: `#64748B`
  Helper text, descriptions, inactive labels.
- Text Soft: `#94A3B8`
  Placeholders and secondary metadata.

### Status Colors

- Success: `#16A34A`
  Successful payments, approved records, completed tasks.
- Warning: `#F59E0B`
  Pending states, reminders, review needed.
- Danger: `#DC2626`
  Destructive actions, failed payments, blocked accounts.
- Info: `#0B8ED0`
  Neutral system notices and tips.

Use status colors sparingly. Primary Blue should still be the main brand action color.

## Typography

Global font:

`Poppins`

The font is set in `client/src/index.css` and should be used everywhere through Tailwind's `font-sans`.

Recommended type scale:

- Page title: 28px to 32px, weight 800 or 900.
- Section title: 20px to 24px, weight 700 or 800.
- Card title: 16px to 18px, weight 700.
- Body text: 14px to 16px, weight 400 or 500.
- Labels: 13px, weight 600.
- Table text: 13px to 14px, weight 500.
- Helper text: 12px to 13px, weight 500.

Rules:

- Do not use negative letter spacing.
- Use uppercase text only for short labels, tabs, badges, and section eyebrows.
- Keep dashboard text compact. The dashboard should be efficient, not oversized.
- Avoid long centered paragraphs inside admin screens.

## Layout Principles

The dashboard should prioritize quick scanning and repeated use.

Recommended desktop shell:

- Fixed left sidebar: 260px wide.
- Main content max width: none for data-heavy pages, but use internal spacing.
- Top page header: 64px to 76px height.
- Content padding: 24px desktop, 16px tablet, 14px mobile.
- Main background: `#EEF6FB`.

Recommended mobile shell:

- Collapse sidebar into a drawer.
- Keep a top bar with logo, page title, and menu button.
- Use full-width cards and tables converted into stacked rows.
- Keep primary actions visible near the top of each page.

Grid guidance:

- Use 12-column grids for dashboard pages on desktop.
- Use 2 to 4 metric cards per row depending on available width.
- On tablets, use 2 columns.
- On mobile, use 1 column.

## Components

### Buttons

Primary button:

- Background: `#0B8ED0`
- Hover: `#0878B7`
- Text: white
- Height: 44px desktop, 42px mobile
- Border radius: 6px to 8px
- Font weight: 700
- Use an icon when the action benefits from quick recognition.

Secondary button:

- Background: white
- Border: `#DDE7EF`
- Text: `#0F172A`
- Hover background: `#F8FBFD`

Danger button:

- Background: `#DC2626`
- Hover: `#B91C1C`
- Text: white

Button rules:

- Use one primary button per main form or page header.
- Do not use bright cyan for every action.
- Icon-only buttons must have accessible labels and hover tooltips later.

### Inputs

Default input:

- Height: 44px.
- Border: `#DDE7EF`.
- Focus border: `#0B8ED0`.
- Focus ring: `rgba(22, 199, 243, 0.15)`.
- Border radius: 6px.
- Placeholder: `#94A3B8`.

Labels:

- 13px, weight 600, color `#0F172A`.
- Place labels above inputs.
- Helper or error text goes under the input.

### Cards

Cards should be simple containers, not decorative boxes.

- Background: white.
- Border: `1px solid #DDE7EF`.
- Border radius: 8px.
- Shadow: very subtle, usually `shadow-sm` or none.
- Padding: 16px to 20px.

Use cards for:

- Metric summaries.
- Tables.
- Forms.
- Repeated dashboard modules.
- Modals.

Avoid nested cards. If a card needs sections, use dividers or internal spacing.

### Sidebar

Desktop sidebar:

- Width: 260px.
- Background: `#0B1831`.
- Logo area height: 72px.
- Nav item height: 42px to 46px.
- Active nav background: `rgba(22, 199, 243, 0.14)`.
- Active nav text: white.
- Inactive nav text: `#CBD5E1`.
- Icons: 18px to 20px.

Sidebar sections:

- Dashboard
- Members
- Payments
- Events
- Voting
- Reports
- Settings

Place lower-priority items like settings and logout near the bottom.

### Top Bar

Desktop top bar:

- Height: 64px to 72px.
- Background: white.
- Border bottom: `#DDE7EF`.
- Contains page title, search, notifications, and user menu.

Mobile top bar:

- Height: 60px.
- Contains menu icon, compact logo, and optional page title.
- Keep it sticky if pages become long.

### Tables

Tables should be dense but readable.

- Header background: `#F8FBFD`.
- Header text: 12px to 13px, weight 700, uppercase optional.
- Row height: 52px to 60px.
- Border color: `#E5EDF3`.
- Hover row: `#F8FBFD`.
- Use badges for statuses.
- Keep actions at the right side.

Mobile table behavior:

- Convert rows into stacked cards, or allow horizontal scroll for data-heavy tables.
- Keep the most important fields visible first.

### Badges

Badge style:

- Height: 24px to 28px.
- Border radius: 999px.
- Font size: 12px.
- Font weight: 700.
- Use light backgrounds with readable colored text.

Examples:

- Paid: green text on pale green.
- Pending: amber text on pale amber.
- Failed: red text on pale red.
- Active: blue text on pale blue.

### Modals

- Overlay: dark navy with 40% to 55% opacity.
- Modal background: white.
- Radius: 8px.
- Width: 420px to 640px depending on content.
- Mobile: modal should use nearly full width with 16px side margin.
- Primary action goes on the right on desktop and full-width on mobile if needed.

## Auth Page Direction

The login screen should stay simple:

- Left brand panel with dark blue gradient and real HIUSA logo.
- Right form panel with white background.
- No stripe decoration.
- No overlapping text.
- Form width around 370px.
- Mobile layout stacks brand panel above form.

Current login component comments are intentionally placed around areas that can become:

- `LogoMark`
- `BrandingPanel`
- `InputField`
- `PrimaryButton`
- `AuthLayout`
- `LoginForm`

## Dashboard Page Ideas

### Dashboard Home

Recommended modules:

- Metric cards: Total Members, Active Payments, Upcoming Events, Open Votes.
- Recent member activity table.
- Payment status summary.
- Upcoming events list.
- Quick actions panel.

Metric card pattern:

- Icon at top-left.
- Label in muted text.
- Main value in strong text.
- Small trend or context line below.

### Members

Recommended features:

- Search and filter bar.
- Member table.
- Status badges.
- View/edit actions.
- Bulk import later.

### Payments

Recommended features:

- Payment summary cards.
- Filters for status and date.
- Payment table.
- Receipt/action menu.

### Events

Recommended features:

- Calendar/list switch.
- Event cards or table.
- Attendance status.
- Create event action.

### Voting

Recommended features:

- Active vote cards.
- Result summary.
- Date/time status.
- Eligibility indicators.

## Spacing

Use an 8px spacing system:

- 4px: tiny icon/text spacing.
- 8px: compact element gaps.
- 12px: form field internal groups.
- 16px: card padding mobile, grouped controls.
- 20px: card padding desktop.
- 24px: dashboard content gap.
- 32px: large section spacing.

Keep spacing consistent so the dashboard feels organized even when it has a lot of data.

## Border Radius

- Inputs and buttons: 6px.
- Cards and panels: 8px.
- Badges: full pill.
- Avoid very rounded cards unless the component is a badge, avatar, or pill control.

## Icons

Use `lucide-react` icons since the project already uses it.

Recommended icon sizes:

- Buttons: 16px to 18px.
- Sidebar nav: 18px to 20px.
- Metric cards: 20px to 24px.
- Empty states: 36px to 48px.

Rules:

- Icons should support labels, not replace important text.
- Keep icon stroke width consistent.
- Use logo blue for active or primary icons.

## Responsive Rules

Breakpoints:

- Mobile: below 640px.
- Tablet: 640px to 1024px.
- Desktop: 1024px and up.

Mobile requirements:

- No horizontal page scrolling.
- Buttons and inputs should be at least 42px tall.
- Text should never overlap or squeeze into tiny columns.
- Dashboard cards stack into one column.
- Tables become stacked rows or horizontal scroll containers.
- Page padding should stay between 14px and 16px.

Desktop requirements:

- Use the available width for tables and dashboard grids.
- Keep primary actions aligned with page headers.
- Sidebar and top bar should remain stable while content changes.

## Accessibility

- Maintain strong contrast between text and background.
- Every input needs a visible label.
- Icon-only actions need `aria-label`.
- Focus states must be visible.
- Do not rely only on color for statuses; include text labels.
- Buttons must use real `button` elements.
- Links and buttons should have clear hover and focus states.

## Implementation Notes

Recommended component structure:

- `components/auth/AuthLayout.jsx`
- `components/auth/BrandingPanel.jsx`
- `components/auth/LoginForm.jsx`
- `components/ui/Button.jsx`
- `components/ui/InputField.jsx`
- `components/ui/Card.jsx`
- `components/layout/DashboardShell.jsx`
- `components/layout/Sidebar.jsx`
- `components/layout/TopBar.jsx`

Recommended Tailwind approach:

- Keep one-off page layout classes in page components.
- Extract repeated button, input, card, badge, and table styles into reusable components.
- Prefer semantic prop names like `variant="primary"` or `status="paid"`.
- Keep component APIs small at first.

## Visual Do And Do Not

Do:

- Use the logo as the main brand anchor.
- Use deep navy for app structure.
- Use primary blue for actions.
- Keep forms and tables clean.
- Use subtle borders instead of heavy shadows.
- Make mobile layouts first-class.

Do not:

- Bring back the stripe decoration.
- Use too many gradients on dashboard pages.
- Put cards inside cards.
- Use huge hero text inside admin pages.
- Use random blue shades that do not match the logo.
- Overuse cyan on every element.
- Let text overlap decorative elements.
