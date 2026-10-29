# Disk usage and clean-up

Everything kang-notes puts on this PC, how big it is, and what you can delete. Everything is on D:; see [What's on C:](#whats-on-c) for the few exceptions.

Measured on 29 Oct 2026.

## What you need to use the app

| Item | Where | Size | Notes |
|---|---|---|---|
| The Windows app | `D:\Work\Personal\apps\kang-notes\app\` | 1 MB | `KangNotes.exe` plus the WebView2 files it needs. Edge's WebView2 engine is already part of Windows |
| Offline copy, sign-in, layout and window positions | `D:\Work\Personal\apps\kang-notes\data\` | Created on first start; grows with your notes | Deleting it signs you out. Your notes stay safe in Firebase and come back when you sign in |
| Backups | `D:\Work\Personal\apps\kang-notes\backups\` | Small (text) | Only what you save from **⋯ → Back up now** |

Your notes themselves are stored in your Firebase project online, and on the phone.

## The project folder: `D:\Work\Personal\apps\kang-notes` (435 MB)

| Item | Size | What it's for | OK to delete? |
|---|---|---|---|
| `web\`, `desktop\`, `tools\`, `test\*.mjs`, config files, docs | 2 MB | The source code | **Keep.** This is the app |
| `app\` | 1 MB | The Windows app | **Keep**, unless you only use the phone. `npm run desktop` rebuilds it |
| `node_modules\` | 429 MB | Build tools: the bundler, the Firebase tool, the test browser driver, and the libraries that go into the app | Yes. `npm install` brings it back (needs the internet) |
| `dist\` | 2 MB | The last build, which gets published to Firebase | Yes. `npm run build` recreates it |
| `test\screens\` | 1 MB | Screenshots from the last test run | Yes |
| `.firebase-cli\` | Under 1 MB | Your Firebase login for publishing updates | Yes, but then you need `npm.cmd run firebase-login` again before publishing |
| `.cache\` | Appears while tests run | The test browser's profile | Yes |

## Shared tools on D:

| Item | Where | Size | OK to delete? |
|---|---|---|---|
| npm's download cache | `D:\Work\Personal\tools\npm-cache\` | 636 MB | Yes. It only makes the next `npm install` faster |
| Temporary files | `D:\Work\Personal\tools\tmp\` | Usually empty | Yes |

Not needed and not installed: the .NET SDK, Visual Studio, Rust, Java or Android tools. `KangNotes.exe` is compiled with the C# compiler that comes with Windows, and the phone app is installed from Chrome.

## What's on C:

kang-notes stores nothing on C:. The exceptions:

| Item | Size | Why |
|---|---|---|
| "Start with Windows" setting | One registry value | Only if you turn it on. Turning it off in the ⋯ menu removes it |
| A taskbar pin | About 1 KB | Only if you pin the app. Windows always keeps pins on C: |
| Windows' own bookkeeping | A few KB | Windows records every program you run, for faster start-up. You can't turn it off; Windows cleans these up by itself |
| Package listings left by a version check during setup | 34 MB | In npm's shared cache on C:, from before the cache was moved to D:. Still to remove: it needs your OK, see the end of the chat |

The tools also already live on C:: Node.js in `C:\nvm4w`, Edge WebView2, and the .NET Framework that's part of Windows. They were all there before kang-notes, and kang-notes adds nothing to them.

## Smallest setup

To keep just what runs the app, delete:
- `node_modules\` (429 MB)
- `dist\` (2 MB)
- `test\screens\` (1 MB)
- `D:\Work\Personal\tools\npm-cache\` (636 MB)

That frees about **1.07 GB** and leaves the app (1 MB), its data, and the source code (2 MB). To change the app later, run `npm install` first.

## Removing kang-notes completely

| Step | What it removes | How |
|---|---|---|
| 1 | The startup entry | Turn off **⋯ → Start with Windows**, or skip this if you never turned it on |
| 2 | The phone app | Long-press its icon, then **Uninstall**. Your notes stay in Firebase |
| 3 | Everything on the PC | Delete `D:\Work\Personal\apps\kang-notes` and `D:\Work\Personal\tools\npm-cache` |
| 4 | Your notes online | Firebase console → Project settings → **Delete project**. This deletes all your notes for good, so make a backup first if you want one |
