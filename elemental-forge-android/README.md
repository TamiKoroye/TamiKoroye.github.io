# Elemental Forge for Android (test builds)

A small native Android app: a fullscreen, landscape WebView that runs the game from files bundled inside the app
(`app/src/main/assets/game`, filled at build time from the published dev build, the `elemental-forge-dev` folder on
`main`). The files are served over `https://appassets.androidplatform.net/assets/game/` by AndroidX
`WebViewAssetLoader`, so the import map and ES modules load as they do on the website. No internet is needed.

Build: `tools/build-apk.sh` (needs the Android SDK at `$ANDROID_HOME`, default `~/android-sdk`, with platform 35,
and Gradle). Output: `dist/elemental-forge-<build>.apk`.

Signing: `test-signing.keystore` signs test builds only, so each new build installs over the previous one. It is
not secret and must not be used for a Play Store release, which needs its own private key kept out of the repository.

Install on the phone: open the `.apk`, allow "Install unknown apps" for the app you opened it from (Files or Chrome),
then Install.
