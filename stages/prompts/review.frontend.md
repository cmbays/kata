# Review Stage — Frontend

## Purpose

Review the frontend implementation for component design quality, accessibility, responsive behavior, performance, and user experience. Produce a structured `frontend-review` artifact with findings and recommendations.

## Review Dimensions

### 1. Component Design

For each significant component, evaluate:

- **Single responsibility**: Does the component do one thing well?
- **Props interface**: Are props typed correctly? No `any`. Are optional props marked `?`.
- **State management**: Is local state minimal? Is shared state in the right place (parent, context, store)?
- **Composition**: Are complex components composed from smaller primitives?
- **Naming**: Component names are PascalCase nouns (`UserCard`, not `renderUserCard`).

### 2. Accessibility (a11y)

- [ ] All interactive elements are keyboard-accessible (tab order, Enter/Space triggers)
- [ ] Images have meaningful `alt` text (or `alt=""` for decorative images)
- [ ] Form inputs have associated `<label>` elements (via `htmlFor` or wrapping)
- [ ] ARIA attributes are correct — `aria-label`, `aria-describedby`, `role` used appropriately
- [ ] Color contrast meets WCAG AA (4.5:1 for normal text, 3:1 for large text)
- [ ] Focus indicators are visible (not `outline: none` without replacement)
- [ ] Dynamic content changes are announced to screen readers (`aria-live`, role="alert")

### 3. Responsive Design

- [ ] Layout works on mobile (360px), tablet (768px), and desktop (1280px+)
- [ ] No horizontal overflow on small screens
- [ ] Touch targets are ≥44×44px on mobile
- [ ] Images are responsive (`max-width: 100%`, framework image components, or native `loading="lazy"`)
- [ ] Typography scales appropriately — no fixed px sizes for body text

### 4. Performance

- [ ] No render-blocking `useEffect` without loading states
- [ ] Heavy components are lazy-loaded (`React.lazy`, dynamic imports)
- [ ] Lists use stable `key` props (not array index when items can reorder)
- [ ] Expensive computations are memoized (`useMemo`, `useCallback` where justified)
- [ ] Images are optimized (WebP/AVIF, correct dimensions, lazy loading)
- [ ] No unnecessary re-renders (check with React DevTools profiler if available)

### 5. User Experience

- [ ] Loading states are visible and informative (not invisible spinners)
- [ ] Error states are helpful — tell the user what went wrong and what to do
- [ ] Empty states are handled gracefully (not blank screens)
- [ ] Form validation feedback is immediate and clear (not just on submit)
- [ ] Destructive actions have confirmation dialogs
- [ ] Success feedback is present after meaningful actions

### 6. Code Quality

- [ ] No inline styles where CSS classes/modules should be used
- [ ] Raw HTML injection APIs are only used when content is sanitized (DOMPurify or equivalent)
- [ ] Event handlers are named `handleX` (not inline lambdas for complex logic)
- [ ] No hardcoded strings that should be constants or i18n keys
- [ ] Consistent use of the project's design system / component library

## Common Frontend Pitfalls

- **Prop drilling past 2 levels**: Extract to context or state management
- **`useEffect` for derived state**: Compute derived values in render, not effects
- **Missing error boundaries**: Unhandled render errors crash the entire app
- **Uncontrolled → controlled transitions**: React warns about this; pick one mode per input
- **Z-index wars**: Use a z-index scale constant (z-10, z-20, z-modal, etc.)

## Output Format

Produce a `frontend-review` artifact at `.kata/artifacts/frontend-review.md`:

```markdown
# Frontend Review: [Feature/Component Name]

## Summary
[2–3 sentence overview of implementation quality and key findings]

## Component Inventory
| Component | Responsibility | Size | Notes |
|-----------|---------------|------|-------|
| UserCard  | Display user  | S    | ✓ OK  |

## Findings

### Critical (breaks functionality or accessibility)
- **[Component]** [Issue]: [Description and fix]

### Major (degrades UX or performance significantly)
- [Finding]: [Description and fix]

### Minor / Suggestions
- [Finding]: [Suggestion]

## Accessibility Assessment
- Keyboard navigation: [Pass/Fail + notes]
- Screen reader: [Pass/Fail + notes]
- Color contrast: [Pass/Fail + notes]
- ARIA usage: [Pass/Fail + notes]

## Responsive Design Assessment
- Mobile (360px): [Pass/Fail + notes]
- Tablet (768px): [Pass/Fail + notes]
- Desktop (1280px+): [Pass/Fail + notes]

## Performance Notes
[Any render, bundle, or image performance concerns]

## Recommendations
1. [Priority 1 action]
2. [Priority 2 action]
```

