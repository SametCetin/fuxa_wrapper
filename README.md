**English** | [Türkçe](README.tr.md)

# fuxaw – desktop app for FUXA projects

Opens, edits and saves [FUXA](https://github.com/frangoteam/FUXA) HMI projects in an application with its own window, and moves a project to the target machine as a single file. Runs on Windows, Linux and macOS (Electron).

- **A project is a folder:** a `.fxprj` file plus one file per view, connection and script. Drawings are `.svg`, script code is `.js`; git diffs read line by line, and an AI agent can edit a single view or script directly.
- Views are designed in the **FUXA editor** embedded in the window. FUXA 1.3.4 and Node.js ship with the app; nothing else needs to be installed.
- **Publish** produces the one file that goes to the target machine: `download-<project>.cmd`, with the project embedded. Nothing is sent over the network; the file is copied by hand.
- A single-file **target machine installer**: `install-fuxa.cmd` installs FUXA, Node.js and the ADS (fuxaw) driver.

Downloads: [Releases](https://github.com/SametCetin/fuxa_wrapper/releases).

> The app's interface is available in English and Turkish (**Settings → Language**). Menu names below are the English labels, with the Turkish label in parentheses.

## Usage

| Menu / shortcut | What it does |
| --------------- | ------------ |
| File → New Project (*Dosya → Yeni Proje*, Ctrl+N) | Empty project ("Adsız"); the file name is asked on first save |
| File → Open Project… (*Proje Aç…*, Ctrl+O) | Opens a `.fxprj`. Older single-file `.fxprj` and plain FUXA JSON (editor *Save Project As*, old `<name>_live.json`) are imported and written as a project folder on first save |
| File → Recent Projects (*Son Projeler*) | Last 10 opened projects |
| File → Save (*Kaydet*, Ctrl+S) / Save As (*Farklı Kaydet*, Ctrl+Shift+S) | Writes the editor state to the project folder (changed files only). If the files changed on disk after opening (git, Syncthing…), it asks before overwriting |
| File → Reload from disk (*Diskten yeniden yükle*) | Reloads the `.fxprj` from disk (normally not needed, see below) |
| File → Publish (to folder)… (*Publish (klasöre)…*, Ctrl+Shift+P) | Writes `<publish folder>/<name>/download-<name>.cmd` from the saved project |
| Project → Editor / Tags / Check (*Proje → Editör / Taglar / Kontrol*, Ctrl+1/2/3) | Tabs |
| Project → Scripts (*Scriptler*, Ctrl+6) | Opens the embedded script management |
| Project → Open runtime (*Runtime'ı aç*, F5) | Opens the running project in a separate window |
| Settings → Connections and tags… (*Ayarlar → Bağlantılar ve tag yönetimi…*, Ctrl+4) | Full connection/tag management: editing, live values, connection import/export |
| Settings → Server plugins… (*Sunucu eklentileri…*, Ctrl+5) | Server plugins; the bundled `@fuxaw/ads-plugin` is listed here; Ctrl+1 returns to the drawing editor |
| Settings → Language (*Ayarlar → Dil*) | English / Türkçe: changes the app and the embedded FUXA editor together. On first start the system language decides (Turkish if the system is Turkish, otherwise English). FUXA's own Turkish translation is incomplete, so some editor texts stay in English |

On start a small splash window ("Bileşenler yükleniyor…") is shown; the main window opens when ready. Commands live in the File/Project/Settings menus (there are no extra buttons in the window).

**If files change outside the app** (AI agent, git, Syncthing), the change reaches the editor without a prompt, only as the changed view/script/connection; PLC connections are not dropped needlessly. Other unsaved edits in the editor are kept. Only if the same item changed on both sides are you asked which one to keep.

Double-clicking a `.fxprj` file also opens the project (the installer registers the file type). Unsaved changes show a `●` in the title and are asked about on close.

**Tabs:**

- **Editor:** the FUXA editor (views, devices, tags, scripts). The editor's own ☰ project menu is hidden; saving/opening is done from the app's File menu.
- **Tags:** the embedded editor's tag table: add, edit, delete, search, live value and timestamp. The first PLC/external device opens first, otherwise the internal server device. The last selected connection is remembered while the same project is open. Use File → Save to write changes to the `.fxprj`.
- **Scripts:** next to the Check tab, or Ctrl+6.
- **Check → Project check:** known FUXA pitfalls (e.g. *Toggle value* on a Boolean ADS tag) and broken tag/script references. Publish is blocked when there is an ERROR.
- **Check → Tag usage:** search over all tags, device and unused filters. The usage count covers view items, events and script references. **Copy** copies the visible rows in a form that pastes into Excel.
- **Connections:** the original device diagram, connection editing and import/export. For a new connection choose **Type → ADS (fuxaw)** and, in the same dialog, **Connection method** (*Bağlantı yöntemi*) → **Local TwinCAT** (*Yerel TwinCAT (Windows)*) or **ADS-TCP**. **ADSclient (original)** uses FUXA's own `ads-client` driver, **ADS (fuxaw)** the separate `@fuxaw/ads-plugin` driver. Both plugins are listed separately on the Server plugins page; ours can be removed and reinstalled offline there.

### ADS polling interval

Connections → pencil icon of the ADS device → set **Polling** to e.g. `100 ms` → **OK**. This value sets the sampling time of the ADS / TCP subscription and the Local TwinCAT read interval; the update loop to the UI uses the same device setting. **OK** reconnects the device; File → Save writes the setting to the `.fxprj`.

**FUXA Server → Polling** in the editor only sets the loop of the server's internal tags; it does not change the ADS device. For Local TwinCAT reads the processing time adds to the interval; 100 ms is not a hard real-time guarantee.

### Publish output

```
<publish folder>/<name>/
├─ download-<name>.cmd   the one file sent to the target (project embedded): double-click backs up the FUXA project and loads this one
└─ <name>.json           the full project (record, git diff, manual Open Project); does not need to be sent
```

In the project that goes to the client, the runtime's editor button (bottom left) is hidden; the project is edited in fuxaw. The publish folder defaults to `publish/` next to the `.fxprj`; it can be changed in the Publish dialog and is saved in the `.fxprj`.

## Deploying to the target machine

Two single-file scripts; neither needs any other file next to it:

| When | File | From | What it does |
| --- | --- | --- | --- |
| Once, on a new machine | `install-fuxa.cmd` | [Releases](https://github.com/SametCetin/fuxa_wrapper/releases) or `npm run dist:installer` | Downloads and installs Node.js + FUXA 1.3.4 into `C:\ProgramData\fuxa`, adds the ADS (fuxaw) driver, creates shortcuts (**Start FUXA**, **FUXA Editor**, **Stop FUXA**) |
| On every project update | `download-<project>.cmd` | fuxaw → File → Publish | Starts FUXA if needed, backs up the current project, loads the new one, reopens the runtime view |

`uninstall-fuxa.cmd` removes FUXA and keeps the project (`data\`). Requirements: 64-bit Windows 10 1803+ / Server 2019+, internet access during install (nodejs.org, npm, github.com). Details (Turkish): [installer/README.md](installer/README.md).

**TwinCAT:** the Windows native ADS bridge is a separate plugin in `integrations/native-ads/`; FUXA's own package files are not modified. The **Local TwinCAT** method uses the Beckhoff ADS library installed on the machine (`TcAdsDll.dll`, part of TwinCAT); that library is not distributed with this project. Details (Turkish): [Native ADS connection](docs/native-ads.md).

## Project folder

```
fuxa1/
├─ fuxa1.fxprj             name, publish folder, item order, layout and remaining settings
├─ views/Main.json         view items
├─ views/Main.svg          drawing
├─ devices/PLC1.json       connection + its tags
├─ scripts/Calc.json       script settings
├─ scripts/Calc.js         script code
└─ publish/                Publish output
```

- Files are matched by the `id` inside them; renaming a view renames its file. Adding a file adds an item, deleting a file deletes the item.
- If one of these files changes outside the app while it is open (AI agent, git, Syncthing), the change reaches the editor on its own.
- One project per folder. Saving into a folder that already holds another project writes the project into its own subfolder.

## Development

```bash
npm install            # Electron + packager; installs FUXA under fuxa-runtime/
npm start              # runs the app in development mode
npm test               # core tests
npm run dist:fast      # quick unsigned Windows build: dist/fast/win-unpacked/fuxaw.exe
npm run dist:installer # target installer: dist/installer/fuxaw-install-*/install-fuxa.cmd
npm run dist           # setup package (NSIS)
```

Development needs Node.js 22+ (it also runs FUXA). For packaging, `scripts/fetch-node.js` downloads a pinned Node.js into `vendor/node/`.

**Versions and releases:** versions have four parts (e.g. `27.1.10.26`). On `main`: `npm run version:set -- 27.1.10.27`, commit, `git tag V27.1.10.27`, `git push --follow-tags`. When the tag arrives, GitHub Actions tests, builds and puts `fuxaw-setup-<version>.exe`, `fuxaw-win-x64-<version>.zip`, `install-fuxa.cmd` and `uninstall-fuxa.cmd` on the [Releases](https://github.com/SametCetin/fuxa_wrapper/releases) page (`.github/workflows/release.yml`). The EXEs are unsigned (SmartScreen warning).

VS Code: **Debug** (runs the app; main process and window debugged together), **Release** (setup package, `dist/`) and **Hızlı EXE** (quick EXE: unsigned, unpacked Windows x64 build, `dist/fast/win-unpacked/fuxaw.exe`) in Run and Debug. Ctrl+Shift+B = Release. The whole `win-unpacked` folder is needed to run or move the quick EXE.

Code structure, design decisions, FUXA API notes and pitfalls: **[AGENTS.md](AGENTS.md)** (Turkish).

## Repository layout

```
fuxa_wrapper/
├─ README.md / README.tr.md / AGENTS.md / CLAUDE.md
├─ package.json             ← Electron app + electron-builder settings
├─ .github/workflows/       ← release (on a V<version> tag)
├─ .vscode/                 ← Debug, Release and quick EXE (launch.json, tasks.json)
├─ src/
│  ├─ core/                 ← model, fxprj, folder, sync, lint, tags, publish (independent of Electron, tested)
│  │  └─ target/            ← scripts that run on the target (download-project template, single-file .cmd wrapper)
│  ├─ main/                 ← main process: main.js, fuxa.js (embedded FUXA), fuxaApi.js
│  ├─ preload.js
│  └─ renderer/             ← window UI + splash window
├─ integrations/native-ads/ ← ADS (fuxaw) driver and Windows native bridge
├─ installer/               ← target install scripts (install-fuxa/uninstall-fuxa templates)
├─ fuxa-runtime/package.json ← bundled FUXA version (1.3.4)
├─ scripts/                 ← fetch-node.js, build-installer.js, set-version.js
└─ tests/                   ← node --test; fixtures/fuxa1_live.json test data
```

## License

[MIT](LICENSE) © 2026 Samet Çetin. Third-party components bundled with or installed by fuxaw (FUXA, Electron, Node.js, ads-client and FUXA's dependencies) keep their own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Beckhoff's `TcAdsDll.dll` is not distributed.

FUXA, TwinCAT and Beckhoff are trademarks of their respective owners. fuxaw is an independent project and is not affiliated with, endorsed by or sponsored by frangoteam or Beckhoff Automation.
