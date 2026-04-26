# Layout Reference

> Auto-extracted from live DOM. Use this to understand how the site is structured spatially.

## Spacing System

**Base grid:** 4px

**Scale:** `2, 4, 8, 12, 14, 16, 20, 24, 32, 36, 40, 48, 64, 80, 96` px

| Spacing | Semantic Use |
|---------|-------------|
| 4px | Tight — within a component |
| 8px | Medium — between sibling items |
| 16px | Wide — between sections |
| 32px | Vast — major section breaks |

## Flex Layouts

| Element | Direction | Justify | Align | Gap | Children |
|---------|-----------|---------|-------|-----|----------|
| `section#hero.relative.min-h-screen` | row | center | center | — | 3 |
| `div.flex.items-center` | row | space-between | center | — | 3 |
| `a.flex.items-center` | row | — | center | 8px | 2 |
| `div.hidden.md:flex` | row | — | center | 32px | 7 |
| `article.glass-card.rounded-xl` | column | — | — | — | 1 |

## Grid Layouts

| Element | Template Columns | Gap | Children |
|---------|-----------------|-----|----------|
| `div.grid.grid-cols-1` | `217.594px 217.594px 217.609px 217.594px 217.609px` | 32px | 4 |
| `div.grid.grid-cols-1` | `552px 552px` | 48px | 2 |
| `div.grid.grid-cols-1` | `389.328px 389.328px 389.344px` | 24px | 3 |
| `div.grid.grid-cols-1` | `384px 384px 384px` | 32px | 3 |
| `div.grid.grid-cols-1` | `362.656px 362.672px 362.656px` | 32px | 3 |
| `div.grid.grid-cols-2` | `169px 169px` | 12px | 2 |

## Structural Containers

### `<nav>` (`nav.fixed.top-0`)

```
display:          block
children:         1
```

### `<footer>` (`footer#footer.bg-slate-900.text-white`)

```
display:          block
children:         4
```

### `<section>` (`section#hero.relative.min-h-screen`)

```
display:          flex
flex-direction:   row
justify-content:  center
align-items:      center
children:         3
```

### `<section>` (`section#solution.section-padding.bg-slate-900`)

```
display:          block
padding:          144px 0px
children:         1
```

### `<section>` (`section#problem.section-padding.bg-slate-900`)

```
display:          block
padding:          144px 0px
children:         1
```

### `<section>` (`section#agents.section-padding.bg-slate-900`)

```
display:          block
padding:          144px 0px
children:         1
```

### `<section>` (`section#value-prop.section-padding.relative`)

```
display:          block
padding:          144px 0px
children:         1
```

### `<section>` (`section#how-it-works.section-padding.bg-slate-950`)

```
display:          block
padding:          144px 0px
children:         1
```

### `<section>` (`section#blogs.section-padding.bg-slate-900/50`)

```
display:          block
padding:          144px 0px
children:         1
```

### `<section>` (`section#cta.section-padding.relative`)

```
display:          block
padding:          144px 0px
children:         1
```

### `<section>` (`section#faq.section-padding.bg-slate-950`)

```
display:          block
padding:          144px 0px
children:         1
```

### `<article>` (`article.glass-card.rounded-xl`)

```
display:          flex
flex-direction:   column
justify-content:  —
align-items:      —
children:         1
```

## Layout Rules

- **Container max-width:** `1280px` — always center with `margin: auto`
- Primary layout system: **Flexbox**
- Secondary layout system: **CSS Grid** (used for card grids and multi-column layouts)
- Every spacing value must be a multiple of **4px**
- Never use arbitrary margin/padding values outside the spacing scale

