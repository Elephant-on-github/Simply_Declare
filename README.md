# simply_declare

A declarative config, theme, and application manager for Linux and Windows.

## Install

```bash
bun install
```

## Usage

```bash
# Run with default config (SimplyDeclare.yml)
bun run ./program.ts

# Run with a specific config
bun run ./program.ts run ./path/to/config.yml

# Validate a config file
bun run ./program.ts validate ./Example.yml

# Initialize a new config
bun run ./program.ts init

# Package management
bun run ./program.ts app install git neovim
bun run ./program.ts app remove bad-app
bun run ./program.ts app update curl
bun run ./program.ts app upgrade
bun run ./program.ts app search terminal
bun run ./program.ts app list
bun run ./program.ts app list --outdated
```

## Build

Compile a standalone binary:

```bash
bun run compile
# or directly:
bun build --compile --outfile=simply-declare ./program.ts
```

## Test

```bash
bun test
bun run test:integration
```

## Config format

See [`Example.yml`](./Example.yml) for the full config format. Supports:

- **Configs** — symlink config files to target paths (local, remote URL, or GitHub raw)
- **Applications** — declare packages to install/remove via the native package manager
