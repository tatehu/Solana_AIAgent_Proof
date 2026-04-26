# Interaction Reference

> Micro-interactions extracted from live DOM. Recreate these exactly for authentic feel.

## Coverage

| Component Type | Count | States Captured |
|----------------|-------|----------------|
| Button | 3 | default, hover, focus |
| Link | 3 | default, hover, focus |

## Transition System

These transition declarations were extracted from interactive elements:

```css
transition: color 0.2s cubic-bezier(0.4, 0, 0.2, 1), background-color 0.2s cubic-bezier(0.4, 0, 0.2, 1), border-color 0.2s cubic-bezier(0.4, 0, 0.2, 1), text-decoration-color 0.2s cubic-bezier(0.4, 0, 0.2, 1), fill 0.2s cubic-bezier(0.4, 0, 0.2, 1), stroke 0.2s cubic-bezier(0.4, 0, 0.2, 1);
transition: 0.3s cubic-bezier(0.4, 0, 0.2, 1);
transition: all;
```

Apply these to all interactive elements. Never invent new durations or easings.

## Button Interactions

### Button 1 — `How It Works`

**States:**

- Default: `../screens/states/button-1-default.png`
- Hover: `../screens/states/button-1-hover.png`
- Focus: `../screens/states/button-1-focus.png`

**On hover:**

```css
/* color: rgb(203, 213, 225) → */ color: rgb(255, 255, 255);
/* outline: rgb(203, 213, 225) none 3px → */ outline: rgb(255, 255, 255) none 3px;
/* outline-color: rgb(203, 213, 225) → */ outline-color: rgb(255, 255, 255);
```

**On focus:**

```css
/* outline: rgb(203, 213, 225) none 3px → */ outline: rgb(0, 95, 204) auto 1px;
/* outline-color: rgb(203, 213, 225) → */ outline-color: rgb(0, 95, 204);
```

**Transition:** `color 0.2s cubic-bezier(0.4, 0, 0.2, 1), background-color 0.2s cubic-bezier(0.4, 0, 0.2, 1), border-color 0.2s cubic-bezier(0.4, 0, 0.2, 1), text-decoration-color 0.2s cubic-bezier(0.4, 0, 0.2, 1), fill 0.2s cubic-bezier(0.4, 0, 0.2, 1), stroke 0.2s cubic-bezier(0.4, 0, 0.2, 1)`

### Button 2 — `Agents`

**States:**

- Default: `../screens/states/button-2-default.png`
- Hover: `../screens/states/button-2-hover.png`
- Focus: `../screens/states/button-2-focus.png`

**On hover:**

```css
/* color: rgb(203, 213, 225) → */ color: rgb(255, 255, 255);
/* outline: rgb(203, 213, 225) none 3px → */ outline: rgb(255, 255, 255) none 3px;
/* outline-color: rgb(203, 213, 225) → */ outline-color: rgb(255, 255, 255);
```

**On focus:**

```css
/* outline: rgb(203, 213, 225) none 3px → */ outline: rgb(0, 95, 204) auto 1px;
/* outline-color: rgb(203, 213, 225) → */ outline-color: rgb(0, 95, 204);
```

**Transition:** `color 0.2s cubic-bezier(0.4, 0, 0.2, 1), background-color 0.2s cubic-bezier(0.4, 0, 0.2, 1), border-color 0.2s cubic-bezier(0.4, 0, 0.2, 1), text-decoration-color 0.2s cubic-bezier(0.4, 0, 0.2, 1), fill 0.2s cubic-bezier(0.4, 0, 0.2, 1), stroke 0.2s cubic-bezier(0.4, 0, 0.2, 1)`

### Button 3 — `Get Started`

**States:**

- Default: `../screens/states/button-3-default.png`
- Hover: `../screens/states/button-3-hover.png`
- Focus: `../screens/states/button-3-focus.png`

**On hover:**

```css
/* box-shadow: rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(59, 130, 246, 0.2) 0px 10px 15px -3px, rgba(59, 130, 246, 0.2) 0px 4px 6px -4px → */ box-shadow: rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(168, 85, 247, 0.5) 0px 25px 50px -12px;
/* transform: none → */ transform: matrix(1.00303, 0, 0, 1.00303, 0, -0.126807);
```

**On focus:**

```css
/* box-shadow: rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(59, 130, 246, 0.2) 0px 10px 15px -3px, rgba(59, 130, 246, 0.2) 0px 4px 6px -4px → */ box-shadow: rgb(2, 6, 23) 0px 0px 0px 2px, rgb(168, 85, 247) 0px 0px 0px 4px, rgba(59, 130, 246, 0.2) 0px 10px 15px -3px, rgba(59, 130, 246, 0.2) 0px 4px 6px -4px;
/* transform: none → */ transform: matrix(1.03207, 0, 0, 1.03207, 0, -1.27939);
/* outline: rgb(255, 255, 255) none 3px → */ outline: rgba(0, 0, 0, 0) solid 2px;
/* outline-color: rgb(255, 255, 255) → */ outline-color: rgba(0, 0, 0, 0);
```

**Transition:** `0.3s cubic-bezier(0.4, 0, 0.2, 1)`

## Link Interactions

### Link 1 — `RentAgents™`

**States:**

- Default: `../screens/states/link-1-default.png`
- Hover: `../screens/states/link-1-hover.png`
- Focus: `../screens/states/link-1-focus.png`

**On focus:**

```css
/* outline: rgb(255, 255, 255) none 3px → */ outline: rgb(0, 95, 204) auto 1px;
/* outline-color: rgb(255, 255, 255) → */ outline-color: rgb(0, 95, 204);
```

**Transition:** `all`

### Link 2 — `Marketing Mesh`

**States:**

- Default: `../screens/states/link-2-default.png`
- Hover: `../screens/states/link-2-hover.png`
- Focus: `../screens/states/link-2-focus.png`

**On hover:**

```css
/* color: rgb(203, 213, 225) → */ color: rgb(255, 255, 255);
/* outline: rgb(203, 213, 225) none 3px → */ outline: rgb(255, 255, 255) none 3px;
/* outline-color: rgb(203, 213, 225) → */ outline-color: rgb(255, 255, 255);
```

**On focus:**

```css
/* outline: rgb(203, 213, 225) none 3px → */ outline: rgb(0, 95, 204) auto 1px;
/* outline-color: rgb(203, 213, 225) → */ outline-color: rgb(0, 95, 204);
```

**Transition:** `color 0.2s cubic-bezier(0.4, 0, 0.2, 1), background-color 0.2s cubic-bezier(0.4, 0, 0.2, 1), border-color 0.2s cubic-bezier(0.4, 0, 0.2, 1), text-decoration-color 0.2s cubic-bezier(0.4, 0, 0.2, 1), fill 0.2s cubic-bezier(0.4, 0, 0.2, 1), stroke 0.2s cubic-bezier(0.4, 0, 0.2, 1)`

### Link 3 — `Blog`

**States:**

- Default: `../screens/states/link-3-default.png`
- Hover: `../screens/states/link-3-hover.png`
- Focus: `../screens/states/link-3-focus.png`

**On hover:**

```css
/* color: rgb(203, 213, 225) → */ color: rgb(255, 255, 255);
/* outline: rgb(203, 213, 225) none 3px → */ outline: rgb(255, 255, 255) none 3px;
/* outline-color: rgb(203, 213, 225) → */ outline-color: rgb(255, 255, 255);
```

**On focus:**

```css
/* outline: rgb(203, 213, 225) none 3px → */ outline: rgb(0, 95, 204) auto 1px;
/* outline-color: rgb(203, 213, 225) → */ outline-color: rgb(0, 95, 204);
```

**Transition:** `color 0.2s cubic-bezier(0.4, 0, 0.2, 1), background-color 0.2s cubic-bezier(0.4, 0, 0.2, 1), border-color 0.2s cubic-bezier(0.4, 0, 0.2, 1), text-decoration-color 0.2s cubic-bezier(0.4, 0, 0.2, 1), fill 0.2s cubic-bezier(0.4, 0, 0.2, 1), stroke 0.2s cubic-bezier(0.4, 0, 0.2, 1)`

## Interaction Rules

- Accent color `#93c5fd` is used for focus rings, active states, and hover highlights
- Hover effects include **color transitions** — use the extracted values, not approximations
- Focus states use **outline** (not box-shadow) — always match the extracted focus ring
- Transition durations in use: `0.2s`, `0.3s`
- Always respect `prefers-reduced-motion` — set all transitions to `0s` when enabled

