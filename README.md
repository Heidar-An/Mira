# Ask-My-Files

## Prerequisites

- [Bun](https://bun.sh/) (v1+)
- [Rust](https://www.rust-lang.org/tools/install) (latest stable)
- [Tauri CLI prerequisites](https://tauri.app/start/prerequisites/) for your OS (e.g. Xcode Command Line Tools on macOS)

## Development

Install dependencies:

```bash
bun install
```

Run the app in development mode (hot-reload):

```bash
bun run tauri dev
```

## Build

Compile a production binary:

```bash
bun run tauri build
```

The distributable will be in `src-tauri/target/release/bundle/`.