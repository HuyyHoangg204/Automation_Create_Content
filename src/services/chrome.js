const path = require('path');
const fs = require('fs-extra');
const { randomUUID } = require('crypto');
const { rootDir, defaultProfilesDir } = require('../config');
const { spawn } = require('child_process');
const { ensureGmailLoggedIn: ensureGmailLoggedInScript } = require('../scripts/gmailLogin');
const { CHROME_DEBUG_HOST } = require('../constants/constants');
let puppeteer;
try { puppeteer = require('puppeteer-core'); } catch (_) { puppeteer = null; }
let WebSocket;
try { WebSocket = require('ws'); } catch (_) { WebSocket = null; }

// Config file để lưu profiles base dir
const PROFILES_CONFIG_FILE = path.join(rootDir, '.profiles-config.json');

async function getProfilesBaseDir() {
  try {
    const config = await fs.readJson(PROFILES_CONFIG_FILE);
    if (config && config.profilesBaseDir && fs.existsSync(config.profilesBaseDir)) {
      return config.profilesBaseDir;
    }
  } catch (_) {
    // Config không tồn tại hoặc invalid
  }
  // Return default
  return defaultProfilesDir;
}

async function setProfilesBaseDir(newDir) {
  const resolvedPath = path.resolve(newDir);
  await fs.ensureDir(resolvedPath);
  await fs.writeJson(PROFILES_CONFIG_FILE, {
    profilesBaseDir: resolvedPath,
    updatedAt: new Date().toISOString()
  }, { spaces: 2 });
  return resolvedPath;
}

function sanitizeName(name) {
  return String(name).replace(/[^a-zA-Z0-9-_\.]/g, '_').slice(0, 100) || 'profile';
}

async function ensureProfilesBaseDir() {
  const profilesBase = await getProfilesBaseDir();
  await fs.ensureDir(profilesBase);
  return profilesBase;
}

async function getProfilesIndexPath() {
  const base = await ensureProfilesBaseDir();
  return path.join(base, 'index.json');
}

async function loadProfilesIndex() {
  const file = await getProfilesIndexPath();
  try {
    const data = await fs.readJson(file);
    if (data && Array.isArray(data.profiles)) return data;
  } catch (_) {
    // ignore
  }
  return { profiles: [] };
}

async function saveProfilesIndex(index) {
  const file = await getProfilesIndexPath();
  await fs.writeJson(file, index, { spaces: 2 });
}

function getChromePathFromEnvOrDefault() {
  const envPath = process.env.CHROME_PATH;
  if (envPath && fs.existsSync(envPath)) return envPath;
  const platform = process.platform;
  const candidates = [];
  if (platform === 'win32') {
    candidates.push(
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
      'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'
    );
  } else if (platform === 'darwin') {
    candidates.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  } else {
    candidates.push('/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/snap/bin/chromium');
  }
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

async function createChromeProfile({ name }) {
  const profilesBase = await ensureProfilesBaseDir();
  const id = randomUUID();
  const safeName = name ? sanitizeName(name) : id;
  const userDataDir = path.join(profilesBase, safeName);
  await fs.ensureDir(userDataDir);
  // Chrome will create internal structure on first launch.
  const profileDirName = 'Default';
  const chromePath = getChromePathFromEnvOrDefault();
  const launchArgs = [
    `--user-data-dir=${userDataDir}`,
    `--profile-directory=${profileDirName}`,
    '--no-first-run',
    '--no-default-browser-check',
  ];
  const meta = {
    id,
    name: safeName,
    dirName: safeName,
    userDataDir,
    profileDirName,
    chromePath,
    launchArgs,
    openCommand: chromePath ? `"${chromePath}" ${launchArgs.join(' ')}` : null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // write profile meta into its folder for easy management
  await fs.writeJson(path.join(userDataDir, 'profile.json'), meta, { spaces: 2 });

  // upsert into global index
  const index = await loadProfilesIndex();
  index.profiles.push({
    id: meta.id,
    name: meta.name,
    dirName: meta.dirName,
    userDataDir: meta.userDataDir,
    profileDirName: meta.profileDirName,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
  });
  await saveProfilesIndex(index);

  return meta;
}

module.exports = { createChromeProfile, getChromePathFromEnvOrDefault };

async function launchChromeProfile({ name, userDataDir, profileDirName = 'Default', extraArgs = [], ensureGmail, headless }) {
  const profilesBase = await ensureProfilesBaseDir();
  const chromePath = getChromePathFromEnvOrDefault();
  if (!chromePath) {
    const err = new Error('Chrome executable not found. Set CHROME_PATH env var.');
    err.status = 500;
    throw err;
  }

  let resolvedUserDataDir = userDataDir;
  if (!resolvedUserDataDir) {
    if (!name) {
      const e = new Error('Either name or userDataDir must be provided');
      e.status = 400;
      throw e;
    }
    resolvedUserDataDir = path.join(profilesBase, sanitizeName(name));
  }
  await fs.ensureDir(resolvedUserDataDir);

  const baseArgs = [
    `--user-data-dir=${resolvedUserDataDir}`,
    `--profile-directory=${profileDirName}`,
    '--no-first-run',
    '--no-default-browser-check',
  ];
  const launchArgs = [...baseArgs, ...extraArgs];

  // Reduce Chrome sign-in interception prompts
  const ensureArg = (flag) => {
    if (!launchArgs.some((a) => a === flag || a.startsWith(`${flag}=`))) {
      launchArgs.push(flag);
    }
  };
  const ensureDisableFeatures = (featuresCsv) => {
    const idx = launchArgs.findIndex((a) => a.startsWith('--disable-features='));
    const toAdd = new Set(featuresCsv.split(',').map((s) => s.trim()).filter(Boolean));
    if (idx >= 0) {
      const cur = launchArgs[idx].slice('--disable-features='.length + 0);
      const curSet = new Set(cur.split(',').map((s) => s.trim()).filter(Boolean));
      for (const f of toAdd) curSet.add(f);
      launchArgs[idx] = `--disable-features=${Array.from(curSet).join(',')}`;
    } else {
      launchArgs.push(`--disable-features=${Array.from(toAdd).join(',')}`);
    }
  };
  ensureArg('--disable-sync');
  ensureArg('--force-signin=false');
  ensureDisableFeatures('ChromeSignin,AccountConsistency,DiceWebSigninInterception,SigninInterceptBubbleV1,SignInProfileCreation');

  // Optional headless mode to fully avoid native OS dialogs being visible
  const useHeadless = typeof headless === 'boolean' ? headless : (String(process.env.HEADLESS || '').toLowerCase() === 'true');
  if (useHeadless) {
    ensureArg('--headless=new');
    ensureArg('--disable-gpu');
    // Provide stable viewport so layout is consistent
    if (!launchArgs.some((a) => a.startsWith('--window-size='))) {
      launchArgs.push('--window-size=1920,1080');
    }
    ensureArg('--hide-scrollbars');
    ensureArg('--mute-audio');
  }

  // Ensure remote debugging to allow Gmail check via puppeteer-core
  let debugPort = parseInt(process.env.CHROME_DEBUG_PORT || '9222', 10);
  const existingDebugArg = launchArgs.find((a) => a.startsWith('--remote-debugging-port='));
  if (existingDebugArg) {
    const p = parseInt(existingDebugArg.split('=')[1], 10);
    if (Number.isInteger(p)) debugPort = p;
  } else {
    launchArgs.push(`--remote-debugging-port=${debugPort}`);
  }

  const child = spawn(chromePath, launchArgs, { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();

  // Persist PID for reliable stop later
  try {
    await fs.writeFile(path.join(resolvedUserDataDir, '.chrome-profile.pid'), String(child.pid || ''));
    await fs.writeFile(path.join(resolvedUserDataDir, '.chrome-profile.debugport'), String(debugPort));
  } catch (_) {
    // ignore
  }

  let gmailCheckStatus = 'skipped';
  if (ensureGmail) {
    try {
      const { ACCOUNT_GOOGLE } = require('../constants/constants');
      const cred = Array.isArray(ACCOUNT_GOOGLE) && ACCOUNT_GOOGLE.length > 0 ? ACCOUNT_GOOGLE[0] : null;
      if (cred) {
        const out = await ensureGmailLoggedInScript({ userDataDir: resolvedUserDataDir, email: cred.email, password: cred.password, debugPort });
        gmailCheckStatus = out.status || 'unknown';
      } else if (puppeteer) {
        // Fallback: just navigate to login if no credentials provided
        const out = await ensureGmailLoggedInScript({ userDataDir: resolvedUserDataDir, email: '', password: '', debugPort });
        gmailCheckStatus = out.status || 'unknown';
      }
    } catch (_) {
      gmailCheckStatus = 'failed';
    }
  }

  return {
    pid: child.pid,
    userDataDir: resolvedUserDataDir,
    profileDirName,
    chromePath,
    launchArgs,
    gmailCheckStatus,
  };
}

module.exports.launchChromeProfile = launchChromeProfile;

async function listChromeProfiles() {
  const index = await loadProfilesIndex();
  return index.profiles;
}

async function getChromeProfileById(id) {
  const index = await loadProfilesIndex();
  const found = index.profiles.find((p) => p.id === id);
  if (!found) return null;
  const profilesBase = await ensureProfilesBaseDir();
  const metaPath = path.join(found.userDataDir, 'profile.json');
  try {
    const meta = await fs.readJson(metaPath);
    return meta;
  } catch (_) {
    return found;
  }
}

module.exports.listChromeProfiles = listChromeProfiles;
module.exports.getChromeProfileById = getChromeProfileById;

function escapeRegex(str) {
  return String(str).replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}

async function stopChromeProfile({ name, userDataDir, profileDirName = 'Default' }) {
  const profilesBase = await ensureProfilesBaseDir();
  let resolvedUserDataDir = userDataDir;
  if (!resolvedUserDataDir) {
    if (!name) {
      const e = new Error('Either name or userDataDir must be provided');
      e.status = 400;
      throw e;
    }
    resolvedUserDataDir = path.join(profilesBase, sanitizeName(name));
  }

  // Build a regex that matches both with and without quotes around the path
  const pattern = `--user-data-dir=${resolvedUserDataDir}`;
  const patternRegex = `--user-data-dir=\\\"?${escapeRegex(resolvedUserDataDir)}\\\"?`;
  const platform = process.platform;

  await fs.ensureDir(resolvedUserDataDir);

  // Try using saved PID first for a reliable stop
  try {
    const pidContent = await fs.readFile(path.join(resolvedUserDataDir, '.chrome-profile.pid'), 'utf8');
    const savedPid = parseInt(String(pidContent).trim(), 10);
    if (Number.isInteger(savedPid) && savedPid > 0) {
      if (platform === 'win32') {
        const tk = spawn('taskkill.exe', ['/PID', String(savedPid), '/F', '/T'], { detached: true, stdio: 'ignore', windowsHide: true });
        tk.unref();
      } else {
        const pk = spawn('pkill', ['-TERM', '-P', String(savedPid)], { detached: true, stdio: 'ignore' });
        pk.unref();
      }
    }
  } catch (_) {
    // ignore if no pid file
  }

  if (platform === 'win32') {
    const ps = [
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-Command',
      `$pids = (Get-CimInstance Win32_Process | Where-Object { $_.Name -like 'chrome.exe' -and $_.CommandLine -match '${patternRegex}' } | Select-Object -ExpandProperty ProcessId); if ($pids) { foreach ($pid in $pids) { Start-Process -FilePath taskkill.exe -ArgumentList @('/PID', $pid, '/F', '/T') -NoNewWindow -WindowStyle Hidden } }`,
    ];
    const child = spawn('powershell.exe', ps, { detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
  } else {
    // macOS/Linux
    const child = spawn('pkill', ['-f', pattern], { detached: true, stdio: 'ignore' });
    child.unref();
  }

  return { stopped: true, userDataDir: resolvedUserDataDir, profileDirName };
}

module.exports.stopChromeProfile = stopChromeProfile;

async function readDebugPort(userDataDir) {
  try {
    const content = await fs.readFile(path.join(userDataDir, '.chrome-profile.debugport'), 'utf8');
    const p = parseInt(String(content).trim(), 10);
    if (Number.isInteger(p) && p > 0) return p;
  } catch (_) {
    // ignore
  }
  const envPort = parseInt(process.env.CHROME_DEBUG_PORT || '9222', 10);
  return envPort;
}

async function connectToBrowserByUserDataDir(userDataDir, preferPort) {
  if (!puppeteer) throw new Error('puppeteer-core not installed');
  const port = preferPort || (await readDebugPort(userDataDir));
  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15000;
  let browser;
  while (!browser && Date.now() < deadline) {
    try {
      // eslint-disable-next-line no-await-in-loop
      browser = await puppeteer.connect({ browserURL: url, defaultViewport: null });
    } catch (e) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 400));
    }
  }
  if (!browser) {
    const err = new Error(`Cannot connect DevTools on ${url}. Make sure profile is launched with remote-debugging.`);
    err.status = 500;
    throw err;
  }
  return { browser, port };
}

async function ensureGmailLogin({ userDataDir, email, password, debugPort: preferPort }) {
  return ensureGmailLoggedInScript({ userDataDir, email, password, debugPort: preferPort });
}

module.exports.ensureGmailLogin = ensureGmailLogin;
module.exports.getProfilesBaseDir = getProfilesBaseDir;
module.exports.setProfilesBaseDir = setProfilesBaseDir;




