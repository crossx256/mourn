# Contributing to MOURN Desktop

Thank you for your interest in contributing to MOURN Desktop! This document outlines our contribution process.

## Licensing and provenance

Submit original contributions under AGPL-3.0-only, the project's outbound code
license; no copyright assignment to Mourn Team is requested. Contributors retain
their copyrights. Only submit material you have the right to contribute under
these terms. Preserve existing copyright and license notices.

Identify third-party code, adaptations, assets and their sources, exact versions,
licenses and required notices in [THIRD_PARTY.md](THIRD_PARTY.md). Do not relabel
third-party work as Mourn Team's. Protocol inspiration (including Signal) is not
proof of implementation provenance or license compatibility. Uncertain provenance
or compatibility must be resolved before inclusion or distribution.

See [NOTICE.md](NOTICE.md), [LICENSE](LICENSE) and [TRADEMARKS.md](TRADEMARKS.md).
Trademark rules do not limit AGPL rights in contributions.

## Code of Conduct

By participating in this project, you agree to abide by our Code of Conduct. Please read it before contributing.

## How Can I Contribute?

### Reporting Bugs

Before reporting a bug:

1. Search existing issues to avoid duplicates
2. Use the bug report template
3. Include:
   - Clear title with steps to reproduce
   - Your environment (OS, version, etc.)
   - Expected vs actual behavior
   - Screenshots if applicable

### Suggesting Features

We welcome feature suggestions! Before creating a new issue:

1. Check the Ideas label
2. Explain the problem you're solving
3. Describe your proposed solution
4. Consider alternative approaches

### Pull Requests

#### Getting Started

1. **Check Issues** - Look for issues tagged with `good first issue` or `help wanted`
2. **Fork the repo** - Create your own fork
3. **Create a branch** - Always create a feature/fix branch:
   ```bash
   git checkout -b feature/your-feature-name
   # or
   git checkout -b fix/bug-description
   ```

#### Development Setup

```bash
# Run from your clone of this repository. See README.md for pinned toolchains.
bun install --frozen-lockfile --ignore-scripts
node node_modules/@quasar/app-vite/bin/quasar.js prepare

# Copy environment template
cp .env.example .env

# Run development server
bun tauri dev
```

#### Before Submitting

- [ ] Code follows our style guidelines
- [ ] `bun run typecheck`, `bun run lint`, `bun run test`, and `bun run test:release` pass
- [ ] No console errors or warnings
- [ ] PR description explains the changes
- [ ] Screenshots/video for UI changes

#### PR Title Format

Use conventional commits format:

```
<type>(<scope>): <description>

Types: feat, fix, docs, style, refactor, test, chore
Scopes: ui, auth, database, etc.
```

**Examples:**

- `feat(ui): Add dark mode toggle`
- `fix(auth): Resolve session timeout issue`
- `docs(readme): Update installation steps`

#### Commit Messages

Keep commits atomic and descriptive:

**Good commit messages:**

- "Add password reset functionality"
- "Fix memory leak in image compression"
- "Update dependencies to latest versions"

**Bad commit messages:**

- "WIP"
- "Fixed stuff"
- "asdfasdf"

### Areas We Need Help

Check our Issue Tracker for current needs:

- Bug fixes
- Performance improvements
- Accessibility improvements
- Documentation
- Testing

## Development Guidelines

### Vue/Quasar

- Use Composition API (`<script setup>`)
- Follow Vue style guide naming
- Use TypeScript for all new components
- Keep components small and focused

### Rust/Tauri

- Follow Rust style guidelines
- Use `cargo clippy` before committing
- Run `cargo fmt` to format code

### General

- Use meaningful variable names
- Add comments for complex logic
- Keep functions cohesive; split responsibilities only when that improves correctness or testing
- Avoid premature optimization

## Recognition

Use Git attribution and existing license notices; do not promise a separate contributors page.

## Questions?

- See [SUPPORT.md](SUPPORT.md) for support and [SECURITY.md](SECURITY.md) for private reports.
- Before submitting third-party assets or licenses, follow [THIRD_PARTY.md](THIRD_PARTY.md).

---

**Thank you for contributing!**
