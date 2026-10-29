# kang-notes

Notes in a 3D graph. Each node is something you take notes for, such as a company like Trilops or Periegesis. Open a node and its projects and notes unfold around it. The same app runs on Windows and on your Android phone, and both stay in sync through your Firebase project.

On Windows it has two layouts, switched with **Simple | Focus** at the top:
- **Simple:** the full app, with the 3D graph and a side panel.
- **Focus:** a small window that stays on top of everything. It has a quick-note box and your notes, with no graph. You can resize it from any edge and drag it by its top bar.

To try it without setting anything up, follow [Try it with sample notes](#try-it-with-sample-notes). To use it for real, follow [Set it up](#set-it-up). It takes about 20 minutes, most of it creating the free Firebase project that stores and syncs your notes.

## What you need

- **Windows 10 or 11** for the desktop app. The phone app runs in Chrome on Android.
- **Node.js 20 or newer**, to build and publish the app.
- **A Google account**, for the free Firebase project. Firebase's free plan doesn't ask for a credit card.
- Optional: **Google Chrome or Microsoft Edge**, to run the automatic tests.

Nothing else is needed. The Windows app is compiled with the C# compiler that comes with Windows, and it draws its window with Microsoft Edge WebView2, which is part of Windows 10 and 11.

## Try it with sample notes

No Firebase needed. Notes stay in your browser.

```
npm install
npm run build
npm run serve
```

Then open **http://localhost:5173/?demo**.

## Set it up

**1. Get the code.** Clone this repository, or download it as a ZIP and unzip it. Open a terminal in the folder and run `npm install`.

`.npmrc` keeps npm's download cache in `D:\Work\Personal\tools\npm-cache`, which is where this project was built. If that folder doesn't exist on your PC, delete the `cache=` line first.

**2. Create your Firebase project** at **console.firebase.google.com**.
1. **Create a project.** You can turn off Google Analytics.
2. **Register the app:** go to **Project settings → Your apps**, click the **`</>`** (Web) icon, give it a nickname and click **Register app**. Copy the `firebaseConfig` block it shows.
3. **Turn on sign-in:** go to **Build → Authentication → Get started → Sign-in method → Email/Password** and turn on the first switch.
4. **Add yourself as the only user:** in **Authentication → Users → Add user**, enter your email and a password. This is your login for the app. Copy the **User UID** from the new row.
5. **Create the database:** go to **Build → Firestore Database → Create database**. Choose the Standard edition, a location near you, and **production mode**.

If Firebase suggests upgrading to a paid plan, decline; the free Spark plan covers everything here.

**3. Point the code at your project.** Make these changes:

| File | Change |
|---|---|
| `web/src/firebase.js` | Replace the `config` values with your `firebaseConfig` |
| `firestore.rules` | Replace the UID with your User UID, so only you can read and write |
| `.firebaserc` | Replace `kang-notes` with your project ID |
| `desktop/KangNotes.cs` | Set `DefaultUrl` to `https://<your-project-id>.web.app/` |

**4. Publish it.** First log in to Firebase. Run this in a terminal you open yourself, because it asks questions and opens your browser:

```
npm.cmd run firebase-login
```

Then publish the app and the database rules:

```
npm run deploy
```

Your app is now at `https://<your-project-id>.web.app`.

**5. Build the Windows app:**

```
npm run desktop
```

This creates `app\KangNotes.exe`, about 1 MB.

## Open it

**On Windows:** run `app\KangNotes.exe` and sign in with the email and password from step 2.
- The first start needs the internet, because the app downloads itself. After that it also works offline.
- To keep it handy, right-click it on the taskbar and choose **Pin to taskbar**.
- To have it open at startup, use **⋯ → Start with Windows**.

**On the phone:** open your app's address (for this project, **https://kang-notes.web.app**) in Chrome and sign in. Then tap Chrome's **⋮** menu and choose **Install app** (on some phones, **Add to Home screen**). It then opens from its own icon, full screen, and works offline.

The first time you sign in, sample notes are added so the graph isn't empty. To remove them, use **⋯ → Remove sample notes**.

## Using it

**The graph (Simple)**
- **What you see:** at first, only your nodes, sized by how many notes they hold.
- **Opening a node:** click or tap it. Its projects and notes unfold around it, the other nodes dim, and the panel lists its notes by project.
- **Going deeper:** click a project, in the graph or its heading in the panel, to see just that project's notes. Click a note dot to open the note.
- **Where you are:** the top of the panel shows it, for example **All nodes › Trilops › Website revamp**. Click any part to go back up. **Esc** goes back one step, and the **kang-notes** logo or `Home` shows all nodes.
- **Moving around:**
  - With a mouse: drag to rotate, scroll to zoom towards the pointer, right-drag to move sideways.
  - On a phone: one finger rotates, pinch zooms, two fingers move.
- Note names appear when you zoom close.

**Quick notes:** every node has a quick-note box at the top of its notes.
- Type and press `Enter` to add the note. `Shift+Enter` starts a new line.
- The first line becomes the title.
- If you've opened a project, the note goes into that project.

**Focus (Windows)**
- **Switching:** click **Focus** at the top, or press `Ctrl+Shift+F`. Click **Simple** to go back; you stay in the same node.
- **Top bar:** pick the node in the coloured box. Type in **All projects** to show one project; quick notes then go into it. **Search all notes** searches every node.
- **Notes:** click one to open it. Project, tags and expiry are folded under **Details**, so the note gets the space.
- **The window:** it stays on top of other windows. Resize it from any edge or corner and move it by dragging its top bar. Focus and Simple each remember their own size and place, and kang-notes reopens in whichever you used last.
- **From anywhere:** `Ctrl+Alt+N` brings kang-notes forward, even when minimized, with the cursor in the quick-note box.

**Notes**
- **New note in the full editor:** **+ Note**, **+ New note** or the `N` key.
- **Writing:** each note has a title and plain text, and saves as you type.
- **Project:** groups notes inside a node. Start typing and existing projects are suggested.
- **Tags:** type a tag and press `Enter`. Search for them with `#tag`.
- **Moving a note:** change the node in the coloured box at the top of the note.
- **History:** the clock-arrow button lists earlier versions. A version is kept each time you finish editing, and you can restore any of them.

**Expiry**
- **Setting it:** pick a date and time, or use **+1 h**, **+1 day** or **+1 week**. **Never** removes it.
- **Before it expires:** in its last 3 days the note slowly fades in the graph.
- **When it expires:** the note bursts and moves to **Trash**. Notes without an expiry stay forever.

**Trash**
- The bin icon shows how many notes are in it.
- **Restore** brings a note back. An expired note asks for a new expiry, or **Keep forever**.
- **Delete forever** and **Empty trash** can't be undone. Nothing leaves the Trash by itself.

**Nodes**
- **+ Node** creates one.
- In a node's panel you can rename it by clicking its name, and change its colour or delete it with **⋯**. Deleting a node moves its notes to Trash.

**Search:** the search box searches every note. Nodes with matches stay lit in the graph, and the rest dim.

**The ⋯ menu:**
- **Back up now:** on Windows it saves to the `backups` folder, on the phone to Downloads.
- **Open backups folder**
- **Start with Windows**
- **Glow effects**
- **Remove sample notes**
- **Sign out**
- The app's version number

**Keyboard on Windows:**

| Key | Does |
|---|---|
| `Ctrl+Alt+N` | From anywhere in Windows: bring kang-notes forward, ready for a quick note |
| `Ctrl+Shift+F` | Switch between Simple and Focus |
| `N` | New note in the full editor |
| `/` or `Ctrl+K` | Search |
| `Esc` | Back |
| `Home` | Show all nodes |

## Syncing

- **The copies:** every device keeps a full copy of your notes, so everything works offline.
- **When you're online,** changes reach the other device within a second or two. The dot in the top bar shows **Synced**, **Saving…** or **Offline**.
- **Editing the same note on both devices while offline:** the later save wins. The other version is in the note's history.
- **Who can get in:** the database only lets in the one account whose UID is in `firestore.rules`.

## Changing the app

The phone and the PC both load the app from your Firebase address. After an update is published, each device picks it up the next time it opens. If you're typing at that moment, it waits and shows **Reload**.

To change it, run these from the project folder:

```
npm install            # only if node_modules is missing
npm run build          # builds the app into dist\web
npm test               # 22 automatic checks in a headless browser: desktop, phone and Focus sizes
npm run deploy         # publishes it, and the database rules, to Firebase
```

`KangNotes.exe` itself rarely needs changing. When it does, run `npm run desktop` to rebuild it. That uses the C# compiler built into Windows, so no extra tools are needed. `node test\desktop.mjs` then runs 18 checks on the exe, including Focus mode. Close kang-notes first: the test window and your mouse pointer move on screen for a few seconds, and your own window position is put back afterwards.

Your Firebase login (from `npm.cmd run firebase-login`) is stored in `.firebase-cli\` in this folder, not in your user profile. Don't share that folder; `.gitignore` keeps it out of git.

## Folders

| Path | What it is | In git? |
|---|---|---|
| `web\` | The app's source: the 3D graph, screens, and how it saves to Firebase | Yes |
| `desktop\` | The Windows app's source (C#), its build script, and the WebView2 files it needs | Yes |
| `tools\` | Scripts to build, serve locally, use the Firebase tool, and draw the icons | Yes |
| `test\` | Automatic checks | Yes, but not their screenshots |
| `firestore.rules` | Who may read and write the database | Yes |
| `firebase.json`, `.firebaserc` | Firebase settings for publishing | Yes |
| `app\` | The built Windows app: `KangNotes.exe` and the WebView2 files it needs, about 1 MB | No. `npm run desktop` builds it |
| `data\` | Created on first start: this PC's offline copy of your notes, your sign-in, and the layout and window positions. Deleting it signs you out; your notes stay safe in Firebase | **No, private** |
| `backups\` | Backups you make from the ⋯ menu | **No, private** |
| `.firebase-cli\` | Your Firebase login | **No, private** |
| `node_modules\`, `dist\` | Build tools and build output; both can be recreated | No |

[SIZES.md](SIZES.md) lists what everything takes on disk and what's safe to delete.

## If something goes wrong

- **"Can't reach kang-notes"** on Windows: the first start needs the internet. Connect, then click **Try again**.
- **"This account can't open these notes":** you signed in with a different account than the one kang-notes allows. Sign out and use the right one.
- **Forgot your password:** use **Forgot password?** on the sign-in screen.
- **`npm run deploy` says the Hosting site wasn't found:** your new project has no website yet. Run `node tools/firebase.mjs hosting:sites:create <your-project-id>`, then deploy again.
- **`npm install` fails on a path starting with `D:\Work\Personal`:** delete the `cache=` line from `.npmrc` (see [Set it up](#set-it-up)).
