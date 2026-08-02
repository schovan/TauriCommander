# Tauri Commander

This template should help get you started developing with Tauri, React and Typescript in Vite.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

## Android

After installing the Android SDK, run the tracked mobile project with:

```sh
bun tauri android dev
```

To build the small, installable arm64 release APK (`app-arm64-release.apk`):

```sh
bun run android:apk
```

Release builds use the standard Android debug certificate when no
`src-tauri/gen/android/keystore.properties` file is present. For public
distribution, provide a private release keystore through that ignored file.
The GitHub release workflow accepts `ANDROID_KEYSTORE_BASE64`,
`ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`, and
`ANDROID_KEYSTORE_PASSWORD` secrets for this purpose.

The first launch asks for Android storage access so the file panes can browse shared storage.
