# Component Reference

> Repeated DOM patterns detected by structural analysis. Each component appeared 3+ times.

## Detected Components

| Component | Category | Instances | Key Classes |
|-----------|----------|-----------|-------------|
| **Gradient Text** | unknown | 10× | `.gradient-text` |
| **Relative** | unknown | 7× | `.relative`, `.z-10` |
| **Relative** | unknown | 7× | `.relative` |
| **Absolute** | unknown | 6× | `.absolute`, `.bg-gradient-to-r`, `.duration-300` |
| **Bg Gradient To R** | button | 5× | `.bg-gradient-to-r`, `.disabled:cursor-not-allowed`, `.disabled:hover:scale-100` |
| **Heading Lg** | unknown | 4× | `.heading-lg`, `.mb-6`, `.text-white` |
| **Backdrop Blur Xl** | card | 4× | `.backdrop-blur-xl`, `.bg-slate-800/50`, `.border` |
| **Container Custom** | unknown | 4× | `.container-custom` |
| **Absolute** | unknown | 4× | `.absolute`, `.bg-blue-500/10`, `.blur-3xl` |
| **Absolute** | unknown | 4× | `.absolute`, `.bg-gradient-to-t`, `.from-slate-900/60` |
| **Font Bold** | unknown | 4× | `.font-bold`, `.text-2xl`, `.text-white` |
| **Bg Gradient To Br** | card | 4× | `.bg-gradient-to-br`, `.duration-300`, `.flex` |
| **Bg Slate 900** | unknown | 3× | `.bg-slate-900`, `.overflow-hidden`, `.relative` |
| **Container Custom** | unknown | 3× | `.container-custom` |
| **Text Center** | unknown | 3× | `.text-center` |
| **Absolute** | unknown | 3× | `.absolute`, `.bg-purple-500/10`, `.blur-3xl` |
| **Mb 20** | unknown | 3× | `.mb-20`, `.text-center` |
| **Cursor Default** | unknown | 3× | `.cursor-default`, `.group`, `.opacity-60` |
| **Backdrop Blur Xl** | card | 3× | `.backdrop-blur-xl`, `.bg-slate-800/50`, `.border` |
| **Relative** | unknown | 3× | `.relative`, `.z-10` |

## Cards

### Backdrop Blur Xl

**Instances found:** 4

**CSS classes:** `.backdrop-blur-xl` `.bg-slate-800/50` `.border` `.border-white/10` `.glass-card` `.mb-12`

**HTML structure:**

```html
<div class="glass-card bg-slate-800/50 backdrop-blur-xl rounded-3xl p-10 mb-12 shadow-2xl border border-white/10" style="opacity: 0; transform: scale(0.95);"><div class="mb-6 flex items-center gap-2"><div class="w-3 h-3 rounded-full bg-red-500 shadow-lg shadow-red-500/50"></div><div class="w-3 h-3 rounded-full bg-yellow-500 shadow-lg shadow-yellow-500/50"></div><div class="w-3 h-3 rounded-full bg-green-500 shadow-lg shadow-green-500/50"></div></div><div class="text-white text-xl font-mono space-y-4"><div class="text-slate-400 text-lg font-sans">Describe your business goal. Watch it ge…</div><d
```

**Base styles (from design tokens):**

```css
.backdrop-blur-xl {
  border: 1px solid #475569;
  border-radius: 1.5rem;
  padding: 8px;
}```

### Bg Gradient To Br

**Instances found:** 4

**CSS classes:** `.bg-gradient-to-br` `.duration-300` `.flex` `.from-blue-500` `.h-16` `.items-center`

**HTML structure:**

```html
<div class="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center mb-6 shadow-lg transition-transform duration-300 opacity-70" style="box-shadow: rgba(59, 130, 246, 0.4) 0px 10px 40px;"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-package w-8 h-8 text-white" aria-hidden="true"><path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 
```

**Base styles (from design tokens):**

```css
.bg-gradient-to-br {
  border: 1px solid #475569;
  border-radius: 1.5rem;
  padding: 8px;
}```

### Backdrop Blur Xl

**Instances found:** 3

**CSS classes:** `.backdrop-blur-xl` `.bg-slate-800/50` `.border` `.border-white/10` `.duration-300` `.glass-card`

**HTML structure:**

```html
<div class="relative glass-card bg-slate-800/50 backdrop-blur-xl rounded-3xl p-8 border border-white/10 transition-all duration-300 h-full"><div class="relative z-10"><div class="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center mb-6 shadow-lg transition-transform duration-300 opacity-70" style="box-shadow: rgba(59, 130, 246, 0.4) 0px 10px 40px;"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-
```

**Base styles (from design tokens):**

```css
.backdrop-blur-xl {
  border: 1px solid #475569;
  border-radius: 1.5rem;
  padding: 8px;
}```

## Buttons

### Bg Gradient To R

**Instances found:** 5

**CSS classes:** `.bg-gradient-to-r` `.disabled:cursor-not-allowed` `.disabled:hover:scale-100` `.disabled:opacity-50` `.disabled:transform-none` `.duration-300`

**HTML structure:**

```html
<button class="font-bold rounded-2xl transition-all duration-300 inline-flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-950 relative overflow-hidden group disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none disabled:hover:scale-100 bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 text-white hover:shadow-2xl hover:shadow-purple-500/50 focus:ring-purple-500 px-8 py-4 text-base shadow-lg shadow-blue-500/20" tabindex="0"><span class="relative z-10">Get Started</span><div class="absolute inset-0 bg-gradient-to
```

**Base styles (from design tokens):**

```css
.bg-gradient-to-r {
  background: #93c5fd;
  color: #1e293b;
  border-radius: 1.5rem;
  padding: 4px 8px;
  cursor: pointer;
}```

## Other Components

### Gradient Text

**Instances found:** 10

**CSS classes:** `.gradient-text`

**HTML structure:**

```html
<span class="gradient-text">Agents™</span>
```

**Base styles (from design tokens):**

```css
.gradient-text {
  padding: 4px;
}```

### Relative

**Instances found:** 7

**CSS classes:** `.relative` `.z-10`

**HTML structure:**

```html
<span class="relative z-10">Get Started</span>
```

**Base styles (from design tokens):**

```css
.relative {
  padding: 4px;
}```

### Relative

**Instances found:** 7

**CSS classes:** `.relative`

**HTML structure:**

```html
<div class="relative" style="opacity: 0; transform: translateX(20px);"><div class="glass-card rounded-3xl overflow-hidden border border-white/10 shadow-2xl shadow-blue-500/10"><img alt="Too much to do, too little you" class="w-full h-auto object-cover" src="/assets/too-much-Cw62tM2G.png"><div class="absolute inset-0 bg-gradient-to-t from-slate-900/60 via-transparent to-transparent pointer-events-none"></div></div></div>
```

**Base styles (from design tokens):**

```css
.relative {
  padding: 4px;
}```

### Absolute

**Instances found:** 6

**CSS classes:** `.absolute` `.bg-gradient-to-r` `.duration-300` `.from-pink-600` `.group-hover:opacity-100` `.inset-0`

**HTML structure:**

```html
<div class="absolute inset-0 bg-gradient-to-r from-pink-600 via-purple-600 to-blue-600 opacity-0 group-hover:opacity-100 transition-opacity duration-300" style="transform: translateX(-100%);"></div>
```

**Base styles (from design tokens):**

```css
.absolute {
  padding: 4px;
}```

### Heading Lg

**Instances found:** 4

**CSS classes:** `.heading-lg` `.mb-6` `.text-white`

**HTML structure:**

```html
<h2 class="heading-lg mb-6 text-white" style="opacity: 0; transform: translateY(20px);">Meet RentAgents™. <span class="gradient-text">Your Autonomous Workforce.</span></h2>
```

**Base styles (from design tokens):**

```css
.heading-lg {
  padding: 4px;
}```

### Container Custom

**Instances found:** 4

**CSS classes:** `.container-custom`

**HTML structure:**

```html
<div class="container-custom"><div class="absolute inset-0 bg-gradient-to-br from-blue-900/20 via-purple-900/20 to-slate-900 pointer-events-none"></div><div class="absolute top-0 left-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl"></div><div class="absolute bottom-0 right-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl"></div><div class="max-w-6xl mx-auto relative z-10"><div class="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center"><div class="text-center lg:text-left space-y-8"><h2 class="heading-lg mb-6" style="opacity: 0; transform: translateY(20px);">Too Much to Do. <br class="
```

**Base styles (from design tokens):**

```css
.container-custom {
  padding: 4px;
}```

### Absolute

**Instances found:** 4

**CSS classes:** `.absolute` `.bg-blue-500/10` `.blur-3xl` `.h-96` `.left-1/4` `.rounded-full`

**HTML structure:**

```html
<div class="absolute top-0 left-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl"></div>
```

**Base styles (from design tokens):**

```css
.absolute {
  padding: 4px;
}```

### Absolute

**Instances found:** 4

**CSS classes:** `.absolute` `.bg-gradient-to-t` `.from-slate-900/60` `.inset-0` `.pointer-events-none` `.to-transparent`

**HTML structure:**

```html
<div class="absolute inset-0 bg-gradient-to-t from-slate-900/60 via-transparent to-transparent pointer-events-none"></div>
```

**Base styles (from design tokens):**

```css
.absolute {
  padding: 4px;
}```

### Font Bold

**Instances found:** 4

**CSS classes:** `.font-bold` `.text-2xl` `.text-white`

**HTML structure:**

```html
<h3 class="text-2xl font-bold text-white">Marketing Mesh Available Now</h3>
```

**Base styles (from design tokens):**

```css
.font-bold {
  padding: 4px;
}```

### Bg Slate 900

**Instances found:** 3

**CSS classes:** `.bg-slate-900` `.overflow-hidden` `.relative` `.section-padding`

**HTML structure:**

```html
<section id="solution" class="section-padding bg-slate-900 relative overflow-hidden" style="opacity: 0; transform: translateY(50px);"><div class="container-custom"><div class="absolute top-0 right-0 w-96 h-96 bg-blue-500/20 rounded-full blur-3xl"></div><div class="absolute bottom-0 left-0 w-96 h-96 bg-purple-500/20 rounded-full blur-3xl"></div><div class="max-w-5xl mx-auto relative z-10"><div class="text-center mb-16"><div class="inline-flex items-center gap-2 mb-6" style="opacity: 0; transform: translateY(20px);"><div class="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 
```

**Base styles (from design tokens):**

```css
.bg-slate-900 {
  padding: 4px;
}```

### Container Custom

**Instances found:** 3

**CSS classes:** `.container-custom`

**HTML structure:**

```html
<div class="container-custom"><div class="absolute top-0 right-0 w-96 h-96 bg-blue-500/20 rounded-full blur-3xl"></div><div class="absolute bottom-0 left-0 w-96 h-96 bg-purple-500/20 rounded-full blur-3xl"></div><div class="max-w-5xl mx-auto relative z-10"><div class="text-center mb-16"><div class="inline-flex items-center gap-2 mb-6" style="opacity: 0; transform: translateY(20px);"><div class="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-lg shadow-blue-500/30"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox=
```

**Base styles (from design tokens):**

```css
.container-custom {
  padding: 4px;
}```

### Text Center

**Instances found:** 3

**CSS classes:** `.text-center`

**HTML structure:**

```html
<div class="text-center" style="opacity: 0; transform: translateY(20px);"><button class="font-bold rounded-2xl transition-all duration-300 inline-flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-950 relative overflow-hidden group disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none disabled:hover:scale-100 bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 text-white hover:shadow-2xl hover:shadow-purple-500/50 focus:ring-purple-500 px-12 py-5 text-lg shadow-xl shadow-blue-500/20" tabindex="0"><span class="rel
```

**Base styles (from design tokens):**

```css
.text-center {
  padding: 4px;
}```

### Absolute

**Instances found:** 3

**CSS classes:** `.absolute` `.bg-purple-500/10` `.blur-3xl` `.bottom-0` `.h-96` `.right-1/4`

**HTML structure:**

```html
<div class="absolute bottom-0 right-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl"></div>
```

**Base styles (from design tokens):**

```css
.absolute {
  padding: 4px;
}```

### Mb 20

**Instances found:** 3

**CSS classes:** `.mb-20` `.text-center`

**HTML structure:**

```html
<div class="text-center mb-20"><h2 class="heading-lg mb-6" style="opacity: 0; transform: translateY(20px);">Agentic Mesh for all aspects of <span class="gradient-text">your Business.</span></h2><p class="text-xl text-slate-300 max-w-3xl mx-auto" style="opacity: 0;">Our AI team handles your daily tasks and…</p></div>
```

**Base styles (from design tokens):**

```css
.mb-20 {
  padding: 4px;
}```

### Cursor Default

**Instances found:** 3

**CSS classes:** `.cursor-default` `.group` `.opacity-60` `.relative`

**HTML structure:**

```html
<div class="relative group cursor-default opacity-60" style="opacity: 0; transform: translateY(30px);"><div class="relative glass-card bg-slate-800/50 backdrop-blur-xl rounded-3xl p-8 border border-white/10 transition-all duration-300 h-full"><div class="relative z-10"><div class="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center mb-6 shadow-lg transition-transform duration-300 opacity-70" style="box-shadow: rgba(59, 130, 246, 0.4) 0px 10px 40px;"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stro
```

**Base styles (from design tokens):**

```css
.cursor-default {
  padding: 4px;
}```

### Relative

**Instances found:** 3

**CSS classes:** `.relative` `.z-10`

**HTML structure:**

```html
<div class="relative z-10"><div class="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center mb-6 shadow-lg transition-transform duration-300 opacity-70" style="box-shadow: rgba(59, 130, 246, 0.4) 0px 10px 40px;"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-package w-8 h-8 text-white" aria-hidden="true"><path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7
```

**Base styles (from design tokens):**

```css
.relative {
  padding: 4px;
}```

## Component Rules

- Match class names exactly from the patterns above
- Each component instance must be visually identical to others of its type
- Do not add extra wrappers or change the DOM structure
- Use `#475569` for all dividers within components
- Use `#93c5fd` for all interactive/active states

