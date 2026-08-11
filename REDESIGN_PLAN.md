# Whispr — UI/UX Redesign Plan
> **Design Inspiration**: Clean, minimal light-theme messenger — white panels, dark nav rail, rounded bubbles, subtle shadows.
> **Brand Color**: Warm Yellow / Amber — unique identity, not blue like Telegram/WhatsApp.

---

## Design Overview

### Before vs After

| | Current (Dark) | Redesign (Light + Yellow) |
|---|---|---|
| **Theme** | Dark navy `#17212B` | Warm off-white `#FAFAF8` |
| **Sidebar** | Dark `#17212B` | White `#FFFFFF` |
| **Sent bubble** | Blue `#2B5278` | **Yellow `#FFB800`** |
| **Recv bubble** | Dark `#182533` | White card `#FFFFFF` |
| **Accent** | Blue `#3390EC` | **Yellow `#FFB800`** |
| **Nav Rail** | Dark navy | Dark `#111111` rounded pills |
| **Font** | Segoe UI | Segoe UI / Inter |
| **Shadows** | None | Subtle `box-shadow` throughout |

---

## 🟡 Yellow Color Palette

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  WHISPR YELLOW PALETTE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  PRIMARY YELLOWS
  ───────────────
  Accent Primary:    #FFB800   ← Main yellow (buttons, active states)
  Accent Hover:      #E5A600   ← Darker yellow on hover/press
  Accent Pressed:    #CC9500   ← Even darker on click
  Accent Light:      #FFF3CC   ← Very light yellow (selected bg, badge bg)
  Accent Pale:       #FFFAED   ← Ultra-light tint (hover on chat items)

  BACKGROUNDS
  ───────────────
  App Background:    #FAFAF8   ← Warm off-white (slightly yellow-tinted)
  Sidebar Panel:     #FFFFFF   ← Pure white
  Chat Area:         #FAFAF8   ← Same as app bg
  Header:            #FFFFFF   ← White, bottom border
  Input Bar:         #FFFFFF   ← White, top border
  Nav Rail:          #111111   ← Near-black dark rail

  MESSAGE BUBBLES
  ───────────────
  Sent bg:           #FFB800   ← Yellow bubble (you)
  Sent text:         #1A1A1A   ← Dark text on yellow (readable)
  Sent timestamp:    #8C6200   ← Dark amber for timestamp inside bubble
  Received bg:       #FFFFFF   ← White card (others)
  Recv text:         #1A1A1A   ← Dark text
  Recv timestamp:    #9BA3AF   ← Muted gray

  TEXT
  ───────────────
  Text Primary:      #1A1A1A   ← Main content
  Text Secondary:    #4B5563   ← Sub-labels, names
  Text Muted:        #9BA3AF   ← Timestamps, previews, placeholders
  Text On Yellow:    #1A1A1A   ← Dark text on yellow surfaces
  Text On Dark:      #FFFFFF   ← White text on dark nav rail

  INDICATORS
  ───────────────
  Online Dot:        #22C55E   ← Green (universally understood = online)
  Unread Badge:      #FFB800   ← Yellow badge, dark number text
  Read Receipt:      #FFB800   ← Yellow double tick (seen)
  Sent Receipt:      #9BA3AF   ← Gray single tick (sent, not seen)
  Active Nav Bar:    #FFB800   ← 3px left bar on active nav icon

  CHAT LIST
  ───────────────
  Item Default:      #FFFFFF   ← White bg
  Item Hover:        #FFFAED   ← Pale yellow tint
  Item Selected:     #FFF3CC   ← Light yellow selected state
  Item Border:       #FFB800   ← 3px left border when selected
  Divider:           #E5E7EB   ← Subtle gray line

  NAV RAIL ICONS
  ───────────────
  Icon Default:      #6B7280   ← Gray
  Icon Hover:        #FFFFFF   ← White
  Icon Active:       #FFB800   ← Yellow (active section)
  Icon Hover Bg:     rgba(255,255,255,0.08)
  Send Button:       #FFB800   ← Yellow circle send button

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### CSS Variables (Web)

```css
:root {
  /* Brand */
  --accent:           #FFB800;
  --accent-hover:     #E5A600;
  --accent-pressed:   #CC9500;
  --accent-light:     #FFF3CC;
  --accent-pale:      #FFFAED;

  /* Backgrounds */
  --app-bg:           #FAFAF8;
  --sidebar-bg:       #FFFFFF;
  --header-bg:        #FFFFFF;
  --input-bg:         #FFFFFF;
  --nav-bg:           #111111;

  /* Bubbles */
  --sent-bg:          #FFB800;
  --sent-text:        #1A1A1A;
  --sent-timestamp:   #8C6200;
  --recv-bg:          #FFFFFF;
  --recv-text:        #1A1A1A;
  --recv-timestamp:   #9BA3AF;

  /* Text */
  --text-primary:     #1A1A1A;
  --text-secondary:   #4B5563;
  --text-muted:       #9BA3AF;

  /* Indicators */
  --online:           #22C55E;
  --unread-badge-bg:  #FFB800;
  --unread-badge-text:#1A1A1A;
  --read-seen:        #FFB800;
  --read-sent:        #9BA3AF;

  /* Chat List */
  --item-hover:       #FFFAED;
  --item-selected:    #FFF3CC;
  --item-border:      #FFB800;
  --divider:          #E5E7EB;

  /* Nav Icons */
  --nav-icon:         #6B7280;
  --nav-icon-active:  #FFB800;
  --nav-icon-hover:   #FFFFFF;

  /* Shadows */
  --shadow-sm:        0 1px 4px rgba(0,0,0,0.06);
  --shadow-md:        0 4px 16px rgba(0,0,0,0.08);
}
```

### WPF Resource Brushes (Desktop)

```xml
<!-- Brand Yellow -->
<SolidColorBrush x:Key="AccentBrush"     Color="#FFB800"/>
<SolidColorBrush x:Key="AccentHover"     Color="#E5A600"/>
<SolidColorBrush x:Key="AccentLight"     Color="#FFF3CC"/>
<SolidColorBrush x:Key="AccentPale"      Color="#FFFAED"/>

<!-- Backgrounds -->
<SolidColorBrush x:Key="AppBg"           Color="#FAFAF8"/>
<SolidColorBrush x:Key="SidebarBg"       Color="#FFFFFF"/>
<SolidColorBrush x:Key="HeaderBg"        Color="#FFFFFF"/>
<SolidColorBrush x:Key="InputBg"         Color="#FFFFFF"/>
<SolidColorBrush x:Key="NavRailBg"       Color="#111111"/>

<!-- Bubbles -->
<SolidColorBrush x:Key="SentBubble"      Color="#FFB800"/>
<SolidColorBrush x:Key="SentText"        Color="#1A1A1A"/>
<SolidColorBrush x:Key="SentTimestamp"   Color="#8C6200"/>
<SolidColorBrush x:Key="RecvBubble"      Color="#FFFFFF"/>
<SolidColorBrush x:Key="RecvText"        Color="#1A1A1A"/>

<!-- Text -->
<SolidColorBrush x:Key="TextPrimary"     Color="#1A1A1A"/>
<SolidColorBrush x:Key="TextSecondary"   Color="#4B5563"/>
<SolidColorBrush x:Key="TextMuted"       Color="#9BA3AF"/>

<!-- States -->
<SolidColorBrush x:Key="ItemHover"       Color="#FFFAED"/>
<SolidColorBrush x:Key="ItemSelected"    Color="#FFF3CC"/>
<SolidColorBrush x:Key="OnlineDot"       Color="#22C55E"/>
<SolidColorBrush x:Key="UnreadBadge"     Color="#FFB800"/>
<SolidColorBrush x:Key="Divider"         Color="#E5E7EB"/>
<SolidColorBrush x:Key="NavIconDefault"  Color="#6B7280"/>
<SolidColorBrush x:Key="NavIconActive"   Color="#FFB800"/>
```


Sent bubble:    #1A1A1A   ← dark / near-black
Recv bubble:    #FFFFFF   ← white card with shadow
Input bar bg:   #FFFFFF   ← white

Accent blue:    #3390EC   ← links, send button, unread badge
Accent green:   #3FC763   ← online dot, delivered checkmark
Text primary:   #1A1A1A   ← headings, names
Text muted:     #9BA3AF   ← timestamps, previews, placeholders
Divider:        #E5E7EB   ← subtle borders
Shadow:         rgba(0,0,0,0.06)  ← card shadows
```

---

## Typography

| Element | Size | Weight |
|---|---|---|
| Chat name (header) | 16px | SemiBold |
| Contact name (list) | 14px | SemiBold |
| Message preview | 13px | Regular |
| Message bubble | 14px | Regular |
| Timestamp | 11px | Regular, muted |
| Section label | 12px | SemiBold, uppercase |
| My username | 14px | SemiBold |

---

## Layout Structure

```
┌──────┬─────────────────────┬──────────────────────────────────┐
│      │                     │                                  │
│ Nav  │   Messages / Groups │         Chat Area                │
│ Rail │   Panel             │                                  │
│ 72px │   320px             │           *                      │
│      │                     │                                  │
└──────┴─────────────────────┴──────────────────────────────────┘
```

---

## Component Breakdown

### 1. Nav Rail (72px, dark `#111111`)

- Rounded rectangle shape (not full height square, more like a pill/capsule)
- Subtle inner rounding on hover states
- Icons: simple line SVGs, white/gray color

```
[Logo]          ← Top: Whispr icon

[Home/Chats]    ← Active: white icon, slight bg highlight
[New Group +]   ← Compose / create group
[Files]         ← Placeholder
[Contacts]      ← Placeholder

---             ← Spacer

[Notifications] ← Placeholder
[Settings]      ← Placeholder
[My Avatar]     ← Bottom: circular avatar, click for profile
```

**States:**
- Default: icon `#6B7280` (gray)
- Hover: icon `#FFFFFF`, bg `rgba(255,255,255,0.08)`
- Active: icon `#FFFFFF`, left accent bar `#3390EC` (3px wide)

---

### 2. Messages List Panel (320px, white)

**Top bar:**
```
┌─────────────────────────────────────┐
│  🔍 Search                          │
└─────────────────────────────────────┘
  Messages                        [Filter ▼]
```

- Search input: `#F3F4F6` bg, rounded-full, search icon left
- Section label: `Messages` — small caps, gray, left aligned

**Chat List Item:**
```
┌──────────────────────────────────────────┐
│  [Avatar]  Name                 4:45 pm  │
│  [dot]     Last message preview...  ✓✓   │
└──────────────────────────────────────────┘
```

- Avatar: 44px circle, colored initials or photo
- Online dot: 10px green `#3FC763` circle, bottom-right of avatar (white ring border)
- Name: 14px SemiBold, `#1A1A1A`
- Preview: 13px, `#9BA3AF`, truncated with ellipsis
- Timestamp: 11px, `#9BA3AF`, right-aligned
- Read receipt: `✓` gray = sent, `✓✓` blue = seen
- **Typing indicator**: `... is typing` in italic green `#3FC763`
- Unread badge: blue `#3390EC` circle, white number, right side
- Hover state: `#F9FAFB` bg
- Selected state: `#EFF6FF` bg, left blue border `3px #3390EC`

**Group items** differ with:
- Stacked 2×2 avatar grid (4 members' initials)
- Member count chip: `👥 5` small pill
- Preview: `"Username: last message..."`

---

### 3. Chat Area (main panel, `#F7F9FA`)

#### Chat Header (`#FFFFFF`, bottom border `1px #E5E7EB`)
```
┌─────────────────────────────────────────────────────┐
│ [Avatar]  Alexander Jameson          [📌] [✏️] [📄] │
│           ● Online                                   │
└─────────────────────────────────────────────────────┘
```
- Avatar: 40px circle
- Name: 16px SemiBold
- Status: 12px, green dot + "Online" / "N members"
- Action buttons right: Pin, Edit (group name), Share — ghost icon buttons

#### Messages Area (`#F7F9FA` background)

**Received bubble** (left-aligned):
```
[Avatar]  ┌─────────────────────────────┐
          │ Message text here            │  ← white card
          └─────────────────────────────┘
           10:37 am
```
- White `#FFFFFF` background
- `border-radius: 4px 18px 18px 18px`
- `box-shadow: 0 1px 4px rgba(0,0,0,0.06)`
- Avatar shown (small, 28px) to the left
- Sender name above (for group chats), colored by hash
- Timestamp below, `#9BA3AF`

**Sent bubble** (right-aligned):
```
           ┌─────────────────────────────┐
           │ Message text here            │  ← dark card
           └─────────────────────────────┘
                                4:45 pm  ✓✓
```
- Dark `#1A1A1A` background, white text
- `border-radius: 18px 18px 4px 18px`
- Timestamp + read receipt bottom-right inside bubble
- No avatar

**Voice message bubble** (placeholder, received):
```
[▶]  ━━━━━━━━━━━━━━━━━━━━━━━━━━━  2:19
```
- Play button circle + waveform bars + duration

**Image/media grid** (placeholder):
```
┌──────┬──────┬──────┐
│ img1 │ img2 │ img3 │
│      │      │  +3  │
└──────┴──────┴──────┘
```

**Date divider:**
```
────────────  Today  ────────────
```
- Centered, `12px`, `#9BA3AF`

#### Input Bar (`#FFFFFF`, top border `1px #E5E7EB`)
```
┌──────────────────────────────────────────────┐
│ 🎤  Write a Message...                   [➤] │
└──────────────────────────────────────────────┘
```
- Mic icon left (placeholder)
- Placeholder text `#9BA3AF`
- Send button: circle `#1A1A1A` with white arrow icon
- Additional buttons: `📎 Attach`, `😊 Emoji` (on focus or hover)

---

## Animations & Micro-interactions

| Trigger | Animation |
|---|---|
| New message received | Slide up + fade in (`translateY(8px)` → `0`, `opacity: 0` → `1`, `150ms ease`) |
| Chat item hover | `background-color` transition `100ms` |
| Send button click | Scale pulse `0.95` → `1`, `100ms` |
| Unread badge | Bounce in on appear |
| Typing indicator | Bouncing dots (3 dots, staggered `0.2s` delay each) |
| Switching chats | Chat area fade `opacity 0` → `1`, `120ms` |
| Online dot | No animation (static) |

---

## Files to Change

### Web

| File | Changes |
|---|---|
| [`style.css`](file:///c:/Users/jessiepinkman/Desktop/Whispr/amproto/frontend/style.css) | Full rewrite — light palette, new component styles |
| [`app.js`](file:///c:/Users/jessiepinkman/Desktop/Whispr/amproto/frontend/app.js) | Update `renderMessages()`, `renderChatList()`, bubble HTML structure |
| [`index.html`](file:///c:/Users/jessiepinkman/Desktop/Whispr/amproto/frontend/index.html) | Update layout structure, add new HTML classes |

### Desktop (WPF)

| File | Changes |
|---|---|
| [`MainWindow.xaml`](file:///c:/Users/jessiepinkman/Desktop/Whispr/WhisprDesktop/MainWindow.xaml) | Full rewrite — light palette, new component styles |
| [`MainWindow.xaml.cs`](file:///c:/Users/jessiepinkman/Desktop/Whispr/WhisprDesktop/MainWindow.xaml.cs) | Update `RenderMessages()`, bubble colors, shadow effects |

---

## Implementation Checklist

### Phase 1 — Foundation
- [ ] Define CSS variables / WPF resource brushes (light palette)
- [ ] Redesign nav rail (dark pill style)
- [ ] Redesign sidebar header (avatar + username + online status)

### Phase 2 — Chat List
- [ ] Chat list item component (avatar, name, preview, timestamp, badge)
- [ ] Online dot indicator
- [ ] Read receipt checkmarks
- [ ] Typing indicator animation
- [ ] Selected / hover states
- [ ] Search bar styling

### Phase 3 — Chat Area
- [ ] Chat header (avatar, name, status, action buttons)
- [ ] Received bubble (white card, shadow, avatar, sender name)
- [ ] Sent bubble (dark, timestamp + read receipt inside)
- [ ] Date divider
- [ ] Input bar (mic, text, send button)
- [ ] Empty state (no chat selected)

### Phase 4 — Polish
- [ ] Micro-animations (message slide-in, hover transitions)
- [ ] Scrollbar styling (thin, subtle)
- [ ] Voice message bubble placeholder
- [ ] Media grid placeholder
- [ ] Responsive feel (resize handles)

### Phase 5 — Group Chat UI
- [ ] Group avatar (stacked 2x2 initials grid)
- [ ] Sender name label in bubbles (group only)
- [ ] Group header (member count, manage button)
- [ ] Create Group modal

---

## Open Questions

> [!NOTE]
> **Custom fonts** — Load Inter from Google Fonts or use Segoe UI (system)? Segoe UI is safe for WPF (built-in), Inter would require bundling.

> [!NOTE]
> **Wallpaper/pattern** — Reference image has a plain light background. Keep plain or add subtle dot/line pattern like Telegram?

> [!NOTE]
> **Login screen** — Keep current card design or match the new light theme (white card on `#F7F9FA` bg)?
