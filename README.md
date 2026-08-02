# Tauri Commander

This template should help get you started developing with Tauri, React and Typescript in Vite.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

## Android

After installing the Android SDK, run the tracked mobile project with:

```sh
bun tauri android dev
```

To build an APK:

```sh
bun tauri android build --debug --apk
```

The first launch asks for Android storage access so the file panes can browse shared storage.
