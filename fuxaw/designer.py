"""Yerel FUXA (designer/editör): bileşen kontrolü, kurulum, başlatma/durdurma.

Bileşenler uygulama klasöründe tutulur (varsayılan %LOCALAPPDATA%\\fuxaw, FUXAW_DATA ile değişir):
  node\\        winget yoksa indirilen taşınabilir Node.js
  fuxa\\        npm ile kurulan FUXA (node_modules\\@frangoteam\\fuxa)
  data\\        FUXA'nın çalışma klasörü (proje verisi data\\_appdata altında)
  logs\\        FUXA çıktısı
  designer.json çalışan FUXA'nın pid/port bilgisi

Node.js önce sistemde aranır; yoksa winget ile (OpenJS.NodeJS.LTS) kurulur. winget yoksa
nodejs.org'dan taşınabilir zip uygulama klasörüne açılır (yönetici izni gerekmez).
"""
import json
import os
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
import webbrowser
import zipfile


FUXA_PKG = "@frangoteam/fuxa"
DEFAULT_FUXA_VERSION = "1.3.4"
WINGET_NODE_ID = "OpenJS.NodeJS.LTS"
NODE_DIST = "https://nodejs.org/dist"


class DesignerError(Exception):
    pass


def _port_open(host, port, timeout=0.5):
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def app_dir():
    base = os.environ.get("FUXAW_DATA") or os.path.join(
        os.environ.get("LOCALAPPDATA") or os.path.expanduser("~"), "fuxaw")
    return os.path.abspath(base)


def _p(*parts):
    return os.path.join(app_dir(), *parts)


# ---------------------------------------------------------------- bileşenler
def find_node():
    """node.exe yolunu döndür (yoksa None). Önce uygulama klasörü, sonra PATH ve bilinen yerler."""
    cands = [_p("node", "node.exe"), shutil.which("node")]
    for env in ("ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"):
        root = os.environ.get(env)
        if root:
            cands.append(os.path.join(root, "nodejs", "node.exe"))
            cands.append(os.path.join(root, "Programs", "nodejs", "node.exe"))
    for c in cands:
        if c and os.path.isfile(c):
            return os.path.abspath(c)
    return None


def find_winget():
    cands = [shutil.which("winget")]
    if os.environ.get("LOCALAPPDATA"):
        cands.append(os.path.join(os.environ["LOCALAPPDATA"], "Microsoft", "WindowsApps", "winget.exe"))
    for c in cands:
        if c and os.path.isfile(c):
            return c
    return None


def node_version(node):
    try:
        return subprocess.run([node, "--version"], capture_output=True, text=True, timeout=15).stdout.strip()
    except OSError:
        return None


def npm_cmd(node):
    npm = os.path.join(os.path.dirname(node), "npm.cmd")
    if not os.path.isfile(npm):
        raise DesignerError(f"npm bulunamadı ({npm})")
    return npm


def fuxa_main():
    return _p("fuxa", "node_modules", *FUXA_PKG.split("/"), "main.js")


def fuxa_version():
    pkg = os.path.join(os.path.dirname(fuxa_main()), "package.json")
    try:
        with open(pkg, encoding="utf-8") as f:
            return json.load(f).get("version")
    except (OSError, ValueError):
        return None


# ---------------------------------------------------------------- kurulum
def _run(cmd, log, **kw):
    log("  > " + " ".join(cmd))
    r = subprocess.run(cmd, **kw)
    return r.returncode


def install_node_winget(winget, log):
    rc = _run([winget, "install", "--id", WINGET_NODE_ID, "-e", "--silent",
               "--accept-package-agreements", "--accept-source-agreements",
               "--disable-interactivity"], log)
    node = find_node()
    if not node:
        raise DesignerError(f"winget Node.js kurulumu başarısız (çıkış kodu {rc})")
    return node


def install_node_portable(log):
    """nodejs.org'dan en yeni LTS win-x64 zip'ini uygulama klasörüne aç."""
    try:
        with urllib.request.urlopen(f"{NODE_DIST}/index.json", timeout=30) as r:
            index = json.load(r)
    except (urllib.error.URLError, OSError, ValueError) as e:
        raise DesignerError(f"Node.js sürüm listesi alınamadı: {e}") from None
    rel = next((x for x in index if x.get("lts") and "win-x64-zip" in x.get("files", [])), None)
    if not rel:
        raise DesignerError("Uygun Node.js LTS sürümü bulunamadı")
    ver = rel["version"]
    name = f"node-{ver}-win-x64"
    url = f"{NODE_DIST}/{ver}/{name}.zip"
    os.makedirs(app_dir(), exist_ok=True)
    zpath = _p(f"{name}.zip")
    log(f"  indiriliyor: {url}")
    try:
        urllib.request.urlretrieve(url, zpath)
    except (urllib.error.URLError, OSError) as e:
        raise DesignerError(f"Node.js indirilemedi: {e}") from None
    tmp = _p("node_tmp")
    shutil.rmtree(tmp, ignore_errors=True)
    with zipfile.ZipFile(zpath) as z:
        z.extractall(tmp)
    shutil.rmtree(_p("node"), ignore_errors=True)
    os.replace(os.path.join(tmp, name), _p("node"))
    shutil.rmtree(tmp, ignore_errors=True)
    os.remove(zpath)
    return _p("node", "node.exe")


def install_fuxa(node, version, log):
    prefix = _p("fuxa")
    os.makedirs(prefix, exist_ok=True)
    env = dict(os.environ)
    # npm.cmd kendi node'unu PATH'te arar; winget sonrası PATH bu süreçte güncel değil
    env["PATH"] = os.path.dirname(node) + os.pathsep + env.get("PATH", "")
    rc = _run([npm_cmd(node), "install", "--prefix", prefix, f"{FUXA_PKG}@{version}",
               "--no-audit", "--no-fund"], log, env=env)
    if rc != 0 or not os.path.isfile(fuxa_main()):
        raise DesignerError(f"FUXA kurulamadı (npm çıkış kodu {rc})")


def _confirm(question, assume_yes, log):
    if assume_yes:
        return True
    if not sys.stdin.isatty():
        log(f"{question} -> onay alınamadı (etkileşimsiz). --yes ile çalıştır.")
        return False
    return input(f"{question} [e/H] ").strip().lower() in ("e", "evet", "y", "yes")


def ensure_components(version=DEFAULT_FUXA_VERSION, assume_yes=False, log=print):
    """Node.js ve FUXA'yı kontrol et, eksikse (onayla) kur. node.exe yolunu döndür."""
    node = find_node()
    if node:
        log(f"Node.js : {node_version(node)}  ({node})")
    else:
        winget = find_winget()
        how = f"winget ile ({WINGET_NODE_ID})" if winget else "nodejs.org'dan taşınabilir zip olarak (winget yok)"
        if not _confirm(f"Node.js bulunamadı. {how} kurulsun mu?", assume_yes, log):
            raise DesignerError("Node.js kurulmadı")
        if winget:
            try:
                node = install_node_winget(winget, log)
            except DesignerError as ex:
                log(f"  {ex}; taşınabilir zip deneniyor")
                node = install_node_portable(log)
        else:
            node = install_node_portable(log)
        log(f"Node.js : {node_version(node)}  ({node})")

    have = fuxa_version()
    if have and have != version:
        log(f"FUXA    : {have} kurulu, istenen {version}")
    if have != version:
        if not _confirm(f"FUXA {version} npm ile {_p('fuxa')} altına kurulsun mu?", assume_yes, log):
            raise DesignerError("FUXA kurulmadı")
        install_fuxa(node, version, log)
    log(f"FUXA    : {fuxa_version()}  ({os.path.dirname(fuxa_main())})")
    return node


# ---------------------------------------------------------------- çalıştırma
def _read_state():
    try:
        with open(_p("designer.json"), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def _write_state(st):
    os.makedirs(app_dir(), exist_ok=True)
    with open(_p("designer.json"), "w", encoding="utf-8") as f:
        json.dump(st, f, indent=2)


def _api_ok(port):
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/settings", timeout=2) as r:
            return r.status == 200
    except (urllib.error.URLError, OSError):
        return False


def _pid_alive(pid):
    if not pid:
        return False
    r = subprocess.run(["tasklist", "/FI", f"PID eq {pid}", "/NH"], capture_output=True, text=True)
    return str(pid) in r.stdout


def start(port=1881, version=DEFAULT_FUXA_VERSION, assume_yes=False, open_browser=True, log=print):
    url = f"http://127.0.0.1:{port}"
    node = ensure_components(version, assume_yes, log)
    if _api_ok(port):
        log(f"FUXA zaten çalışıyor: {url}")
    else:
        if _port_open("127.0.0.1", port):
            raise DesignerError(f"{port} portu başka bir uygulama tarafından kullanılıyor (--port ile değiştir)")
        data = _p("data")
        os.makedirs(data, exist_ok=True)
        os.makedirs(_p("logs"), exist_ok=True)
        logf = open(_p("logs", "fuxa.log"), "ab")
        # fuxaw kapansa da FUXA çalışmaya devam etsin (konsolsuz, ayrı süreç grubu)
        flags = getattr(subprocess, "DETACHED_PROCESS", 0) | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
        # FUXA veriyi çalışma klasöründeki _appdata'ya yazar -> cwd = data\
        proc = subprocess.Popen([node, fuxa_main(), "--port", str(port)], cwd=data,
                                stdin=subprocess.DEVNULL, stdout=logf, stderr=subprocess.STDOUT,
                                creationflags=flags)
        _write_state({"pid": proc.pid, "port": port, "started": time.strftime("%Y-%m-%d %H:%M:%S")})
        log(f"FUXA başlatılıyor (pid {proc.pid}, veri: {data}) ...")
        deadline = time.time() + 90
        while not _api_ok(port):
            if proc.poll() is not None:
                raise DesignerError(f"FUXA kapandı (çıkış kodu {proc.returncode}); log: {_p('logs', 'fuxa.log')}")
            if time.time() > deadline:
                raise DesignerError(f"FUXA 90 sn içinde hazır olmadı; log: {_p('logs', 'fuxa.log')}")
            time.sleep(0.5)
        log(f"FUXA hazır: {url}")
    log(f"  editör : {url}/editor\n  runtime: {url}/home")
    if open_browser:
        webbrowser.open(f"{url}/editor")
    return url


def stop(log=print):
    st = _read_state()
    pid = st.get("pid")
    if not _pid_alive(pid):
        log("fuxaw'ın başlattığı çalışan bir FUXA yok.")
        return False
    subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True)
    log(f"FUXA durduruldu (pid {pid}).")
    st["pid"] = None
    _write_state(st)
    return True


def info():
    """Bileşen ve çalışma durumu (arayüz için)."""
    node = find_node()
    st = _read_state()
    port = st.get("port", 1881)
    running = _api_ok(port)
    return {
        "app_dir": app_dir(), "winget": find_winget(),
        "node": node, "node_version": node_version(node) if node else None,
        "fuxa_version": fuxa_version(), "fuxa_wanted": DEFAULT_FUXA_VERSION,
        "port": port, "running": running, "url": f"http://127.0.0.1:{port}",
        "pid": st.get("pid") if running and _pid_alive(st.get("pid")) else None,
    }


def status(log=print):
    i = info()
    log(f"Uygulama klasörü: {i['app_dir']}")
    log(f"winget : {i['winget'] or 'yok'}")
    log(f"Node.js: {(i['node_version'] + '  (' + i['node'] + ')') if i['node'] else 'yok'}")
    log(f"FUXA   : {i['fuxa_version'] or 'kurulu değil'}")
    if i["running"]:
        who = f"pid {i['pid']}" if i["pid"] else "fuxaw dışında başlatılmış"
        log(f"Durum  : çalışıyor, {i['url']}  ({who})")
    else:
        log("Durum  : çalışmıyor")
