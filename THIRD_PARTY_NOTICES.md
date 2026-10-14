# Third-party notices

fuxaw is licensed under the [MIT License](LICENSE). Its releases also contain or install third-party software, each under its own license. Each bundled npm package keeps its own `LICENSE`/`package.json` inside its `node_modules` folder in the distribution.

## Bundled in the fuxaw app (`fuxaw-setup-*.exe`, `fuxaw-win-x64-*.zip`)

| Component | Version | License | Copyright |
| --- | --- | --- | --- |
| [FUXA](https://github.com/frangoteam/FUXA) (`@frangoteam/fuxa`) | 1.3.4 | MIT | Copyright (c) 2019-2025 frangoteam |
| [Electron](https://github.com/electron/electron) | 44.x | MIT | Copyright (c) Electron contributors, Copyright (c) 2013-2020 GitHub Inc. |
| Chromium and other Electron components | – | Various (BSD and others) | See `LICENSES.chromium.html` next to `fuxaw.exe` |
| [Node.js](https://nodejs.org) | 24.19.0 | MIT and others | See `resources/node/LICENSE` |
| [ads-client](https://github.com/jisotalo/ads-client) | 2.1.0 | MIT | Copyright (c) Jussi Isotalo |
| FUXA's own dependencies (incl. Node-RED, Apache-2.0) | – | Permissive licenses only | See each package under `resources/fuxa/node_modules` |

License scan of FUXA 1.3.4's dependency tree (659 packages, 2026-10-14): MIT 448, ISC 135, Apache-2.0 28, BSD-2-Clause 16, BSD-3-Clause 10, BlueOak-1.0.0 10, and one each of Python-2.0, Artistic-2.0, CC-BY-3.0, CC0-1.0, 0BSD, MIT-0, (MIT AND Zlib), (MIT OR WTFPL), (BSD-2-Clause OR MIT OR Apache-2.0). Three packages without a license field (`cli-table`, `png-js`, `pause`) are MIT according to their own files. No GPL/AGPL (copyleft) licenses were found.

## Installed by `install-fuxa.cmd` (target machine)

`install-fuxa.cmd` itself contains only fuxaw code and the ADS (fuxaw) plugin (fuxaw code, an adapted copy of FUXA's ADS driver under FUXA's MIT license — see [`integrations/native-ads/FUXA-LICENSE`](integrations/native-ads/FUXA-LICENSE) — and ads-client, MIT). Node.js and FUXA with its dependencies are downloaded from their official sources (nodejs.org, the npm registry) during installation, under their own licenses as listed above.

## Not distributed

The **Local TwinCAT** connection method uses the Beckhoff ADS library (`TcAdsDll.dll`) that is installed on the machine together with TwinCAT. It is not part of fuxaw and is not distributed with it; its use is subject to Beckhoff's license terms.

## Trademarks

FUXA, TwinCAT and Beckhoff are trademarks of their respective owners. fuxaw is an independent project and is not affiliated with, endorsed by or sponsored by frangoteam or Beckhoff Automation.
