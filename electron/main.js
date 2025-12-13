import { app, BrowserWindow, globalShortcut, ipcMain } from 'electron'
import { autoUpdater } from 'electron-updater'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { randomUUID } from 'node:crypto'

// Phải định nghĩa require trước khi sử dụng
const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Helper function to get correct paths (works in both dev and production)
function getAppPaths() {
  let projectRoot, srcPath, envPath
  
  if (app.isPackaged) {
    // Production: use app.getAppPath() to get path to app.asar
    projectRoot = app.getAppPath()
    srcPath = path.join(projectRoot, 'src')
    // .env is unpacked, so it's in app.asar.unpacked or resources
    const resourcesPath = process.resourcesPath || path.join(path.dirname(projectRoot), '..', 'resources')
    envPath = path.join(resourcesPath, '.env')
    // Also try app.asar.unpacked
    if (!fs.existsSync(envPath)) {
      const unpackedPath = path.join(path.dirname(projectRoot), 'app.asar.unpacked', '.env')
      if (fs.existsSync(unpackedPath)) {
        envPath = unpackedPath
      }
    }
  } else {
    // Development: use __dirname
    projectRoot = path.join(__dirname, '..')
    srcPath = path.join(projectRoot, 'src')
    envPath = path.join(projectRoot, '.env')
  }
  
  return { projectRoot, srcPath, envPath }
}

// Initialize paths (will be updated in app.whenReady if needed)
let { projectRoot, srcPath, envPath } = getAppPaths()
process.env.APP_ROOT = projectRoot

// Logging helper - write to file and console
const logDir = path.join(os.homedir(), 'AppData', 'Local', 'Automation_Profiles', 'logs')
const logFile = path.join(logDir, `app-${new Date().toISOString().split('T')[0]}.log`)

// Ensure log directory exists
try {
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true })
  }
} catch (e) {
  // Ignore if can't create log dir
}

function writeLog(level, message, data = null) {
  const timestamp = new Date().toISOString()
  const logEntry = {
    timestamp,
    level,
    message,
    data
  }
  
  // Write to file
  try {
    const logLine = `[${timestamp}] [${level}] ${message}${data ? ' ' + JSON.stringify(data) : ''}\n`
    fs.appendFileSync(logFile, logLine, 'utf8')
  } catch (e) {
    // Ignore if can't write to file
  }
  
  // Write to console
  const consoleMessage = `[${level}] ${message}${data ? ' ' + JSON.stringify(data, null, 2) : ''}`
  if (level === 'error') {
    console.error(consoleMessage)
  } else if (level === 'warn') {
    console.warn(consoleMessage)
  } else {
    console.log(consoleMessage)
  }
  
  // Send to renderer if window is ready
  if (win && win.webContents && !win.webContents.isDestroyed()) {
    try {
      win.webContents.send('main-process-log', logEntry)
    } catch (e) {
      // Ignore if can't send to renderer
    }
  }
}

// Modules will be loaded in app.whenReady to avoid initialization errors
// Don't load at top-level in production builds as it can cause circular dependency issues
let logService, constants

export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

// Backend API Configuration - lazy getters to avoid initialization error
function getBackendApiUrl() {
  if (!constants) {
    return 'http://158.69.59.214:8080' // fallback
  }
  return constants.BACKEND_API_URL || 'http://158.69.59.214:8080'
}

function getBackendApiKey() {
  if (!constants) {
    return ''
  }
  return constants.BACKEND_API_KEY || ''
}

// FRP Configuration - lazy getters
function getFrpServerAddr() {
  if (!constants) {
    return '158.69.59.214' // fallback
  }
  return constants.FRP_SERVER_ADDR || '158.69.59.214'
}

function getFrpServerPort() {
  if (!constants) {
    return '7000' // fallback
  }
  return constants.FRP_SERVER_PORT || '7000'
}

function getFrpAuthToken() {
  if (!constants) {
    return '' // fallback
  }
  return constants.FRP_AUTH_TOKEN || ''
}

function getFrpSubdomain() {
  if (!constants) {
    return null
  }
  return constants.FRP_SUBDOMAIN || null
}

function getFrpSubdomainHost() {
  if (!constants) {
    return 'autogencontent.xyz' // fallback
  }
  return constants.FRP_SUBDOMAIN_HOST || 'autogencontent.xyz'
}

let win = null
let apiServer = null
let tunnelProcess = null
let tunnelUrl = null
let tunnelConnected = false
let currentMachineId = null
let heartbeatInterval = null

// Start Express API Server
async function startAPIServer() {
  try {
    writeLog('info', '🚀 Starting API server...')
    
    // Update paths if app is packaged
    if (app.isPackaged) {
      const paths = getAppPaths()
      projectRoot = paths.projectRoot
      srcPath = paths.srcPath
      envPath = paths.envPath
      process.env.APP_ROOT = projectRoot
      writeLog('info', 'Updated paths for production', { projectRoot, srcPath, envPath })
    }
    
    // Load modules if not loaded yet (should already be loaded in app.whenReady, but just in case)
    if (!logService || !constants) {
      writeLog('info', 'Loading modules in startAPIServer...')
      try {
        const backendRequire = createRequire(import.meta.url)
        const currentSrcPath = app.isPackaged ? srcPath : path.join(__dirname, '..', 'src')
        logService = backendRequire(path.join(currentSrcPath, 'services', 'logService'))
        constants = backendRequire(path.join(currentSrcPath, 'constants', 'constants'))
        writeLog('info', 'Modules loaded successfully')
      } catch (error) {
        writeLog('error', 'Failed to load modules', { error: error.message })
        // Continue anyway, getters will use fallback values
      }
    }
    
    writeLog('info', 'Path information', {
      __dirname,
      projectRoot,
      srcPath,
      envPath,
      isPackaged: app.isPackaged,
      appPath: app.isPackaged ? app.getAppPath() : 'N/A',
      resourcesPath: process.resourcesPath || 'N/A'
    })
    
    // Check if srcPath exists
    if (!fs.existsSync(srcPath)) {
      throw new Error(`src/ folder not found at: ${srcPath}`)
    }
    writeLog('info', 'src/ folder exists', { srcPath })
    
    // Use createRequire to load CommonJS modules from src/
    const backendRequire = createRequire(import.meta.url)
    
    writeLog('info', 'Loading backend modules...')
    const backend = backendRequire(path.join(srcPath, 'index.js'))
    const config = backendRequire(path.join(srcPath, 'config.js'))
    const { createApp } = backend
    const { port } = config
    
    writeLog('info', 'Backend modules loaded', { port })
    
    writeLog('info', 'Creating Express app...')
    const expressApp = await createApp()
    
    writeLog('info', `Starting server on 127.0.0.1:${port}`)
    apiServer = expressApp.listen(port, '127.0.0.1', () => {
      writeLog('success', `✅ Server started successfully on http://127.0.0.1:${port}`)
    })
    
    apiServer.on('error', (error) => {
      writeLog('error', '❌ Server error', { 
        message: error.message, 
        code: error.code,
        stack: error.stack 
      })
      if (error.code === 'EADDRINUSE') {
        writeLog('error', `Port ${port} is already in use`)
      }
    })
  } catch (error) {
    writeLog('error', '❌ Failed to start API server', { 
      message: error.message,
      stack: error.stack,
      srcPath,
      projectRoot
    })
  }
}

// Get Windows Machine GUID from registry
async function getWindowsMachineGuid() {
  if (process.platform !== 'win32') {
    return null
  }
  
  try {
    const { exec } = await import('node:child_process')
    const { promisify } = await import('node:util')
    const execAsync = promisify(exec)
    
    // Get Machine GUID from registry
    // HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Cryptography\MachineGuid
    const { stdout, stderr } = await execAsync('reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid', {
      encoding: 'utf8',
      timeout: 5000
    })
    
    // Try multiple regex patterns to match different output formats
    const patterns = [
      /MachineGuid\s+REG_SZ\s+([a-f0-9-]+)/i,
      /MachineGuid\s+REG_SZ\s+\{?([a-f0-9-]+)\}?/i,
      /([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i
    ]
    
    for (const pattern of patterns) {
      const match = stdout.match(pattern)
      if (match && match[1]) {
        const guid = match[1].replace(/[{}]/g, '').toLowerCase()
        return guid
      }
    }
  } catch (error) {
    // Failed to get Machine GUID
  }
  
  return null
}

// Get real machine ID from system
async function getOrCreateMachineId() {
  const machineIdFile = path.join(os.homedir(), '.automation-machine-id')
  
  // 1. ALWAYS try Windows Machine GUID first (most reliable and unique)
  let actualGuid = null
  if (process.platform === 'win32') {
    actualGuid = await getWindowsMachineGuid()
  }
  
  // 2. If we have actual GUID, use it (ignore file to ensure uniqueness)
  if (actualGuid) {
    const machineId = actualGuid.replace(/-/g, '')
    
    // Validate file ID with actual GUID
    try {
      if (fs.existsSync(machineIdFile)) {
        const existingId = fs.readFileSync(machineIdFile, 'utf8').trim()
        const cleanExistingId = existingId.replace(/^xeon-/, '')
        
        // If file ID is different from actual GUID, regenerate (file might be copied from another machine)
        if (cleanExistingId !== machineId) {
          // Overwrite file with actual GUID
          fs.writeFileSync(machineIdFile, machineId, 'utf8')
        }
      } else {
        // Save actual GUID to file for future use
        fs.writeFileSync(machineIdFile, machineId, 'utf8')
      }
    } catch (_) {
      // Ignore if can't write, but still return GUID
    }
    
    return machineId
  }
  
  // 3. If Machine GUID not available, check existing file
  let machineId = null
  try {
    if (fs.existsSync(machineIdFile)) {
      const existingId = fs.readFileSync(machineIdFile, 'utf8').trim()
      // Check if existing ID is Machine GUID format ({32hex} or xeon-{32hex})
      const isGuidFormat = /^[a-f0-9]{32}$/i.test(existingId) || /^xeon-[a-f0-9]{32}$/i.test(existingId)
      
      if (isGuidFormat) {
        // Existing ID is GUID format, use it (remove xeon- prefix if present)
        const cleanId = existingId.replace(/^xeon-/, '')
        return cleanId
      } else {
        // File exists but not GUID format - might be hostname (could be duplicate)
        // Check if it looks like a hostname (contains non-hex chars or is short)
        const looksLikeHostname = existingId.length < 32 || /[^a-f0-9]/i.test(existingId)
        if (looksLikeHostname) {
          // Will regenerate below with hostname + random suffix
        } else {
          // Use existing ID if it's not obviously a hostname
          return existingId
        }
      }
    }
  } catch (_) {
    // Ignore
  }
  
  // 4. If Machine GUID not available and no valid file, try hostname + random suffix (to avoid duplicates)
  if (!machineId) {
    const hostname = os.hostname()
    if (hostname && hostname !== 'localhost' && hostname.trim() !== '') {
      // Sanitize hostname: remove invalid chars, lowercase
      const sanitizedHostname = hostname.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
      // Add random suffix to ensure uniqueness even if hostname is duplicate
      const randomSuffix = randomUUID().replace(/-/g, '').slice(0, 8)
      machineId = `${sanitizedHostname}-${randomSuffix}`
    }
  }
  
  // 5. If hostname not available, try MAC address
  if (!machineId || machineId === 'localhost' || machineId.trim() === '') {
    try {
      const networkInterfaces = os.networkInterfaces()
      for (const name of Object.keys(networkInterfaces)) {
        const interfaces = networkInterfaces[name]
        for (const iface of interfaces || []) {
          if (!iface.internal && iface.mac && iface.mac !== '00:00:00:00:00:00') {
            // Use full MAC address (no prefix)
            machineId = iface.mac.replace(/:/g, '').toLowerCase()
            break
          }
        }
        if (machineId) break
      }
    } catch (_) {
      // Ignore
    }
  }
  
  // 6. Fallback: use random UUID only if all above failed
  if (!machineId || machineId === 'localhost' || machineId.trim() === '') {
    machineId = randomUUID().replace(/-/g, '')
  }
  
  // Save for future use
  try {
    fs.writeFileSync(machineIdFile, machineId, 'utf8')
  } catch (_) {
    // Ignore if can't write
  }
  
  return machineId
}

// Generate FRP client config
async function generateFrpcConfig(machineId, apiPort) {
  // Get config from constants using getters
  const serverAddr = getFrpServerAddr()
  const serverPort = getFrpServerPort()
  const authToken = getFrpAuthToken()
  const subdomain = getFrpSubdomain() || machineId.replace(/[^a-zA-Z0-9-]/g, '-')
  
  // Generate config content
  // Note: log.to = "console" để log ra stdout (để có thể capture)
  const config = `serverAddr = "${serverAddr}"
serverPort = ${serverPort}

auth.method = "token"
auth.token = "${authToken}"

webServer.addr = "127.0.0.1"
webServer.port = 7400

log.to = "console"
log.level = "info"

[[proxies]]
name = "${machineId}-api"
type = "http"
localIP = "127.0.0.1"
localPort = ${apiPort}
subdomain = "${subdomain}"
`
  return config
}

// Get FRP client executable path
function getFrpcExecutable() {
  const platform = process.platform
  const exeName = platform === 'win32' ? 'frpc.exe' : 'frpc'
  
  // In production: __dirname = app.asar/dist-electron
  // In dev: __dirname = electron/ hoặc dist-electron/
  
  // Try multiple locations (order matters - unpacked paths first for production)
  const possiblePaths = []
  
  if (app.isPackaged) {
    // Production mode: frpc.exe should be in app.asar.unpacked
    const resourcesPath = process.resourcesPath || path.join(path.dirname(app.getAppPath()), '..', 'resources')
    
    // 1. app.asar.unpacked/electron/tunnel/ (production - unpacked)
    const unpackedPath = path.join(resourcesPath, 'app.asar.unpacked', 'electron', 'tunnel', exeName)
    possiblePaths.push(unpackedPath)
    
    // 2. resources/electron/tunnel/ (alternative location)
    possiblePaths.push(path.join(resourcesPath, 'electron', 'tunnel', exeName))
  } else {
    // Development mode
    const projectRoot = path.join(__dirname, '..')
    
    // 1. electron/tunnel/ (dev mode)
    possiblePaths.push(path.join(projectRoot, 'electron', 'tunnel', exeName))
    
    // 2. dist-electron/tunnel/ (build mode - if copied)
    possiblePaths.push(path.join(__dirname, 'tunnel', exeName))
    
    // 3. frp_0.65.0_windows_amd64/ (fallback)
    possiblePaths.push(path.join(projectRoot, 'frp_0.65.0_windows_amd64', exeName))
  }
  
  // Try each path
  for (const exePath of possiblePaths) {
    if (fs.existsSync(exePath)) {
      return exePath
    }
  }
  
  return null
}

// Kill all existing frpc processes
async function killExistingFrpcProcesses() {
  try {
    const { exec } = await import('node:child_process')
    const platform = process.platform
    
    if (platform === 'win32') {
      // Windows: kill all frpc.exe processes
      return new Promise((resolve) => {
        exec('taskkill /F /IM frpc.exe /T', (error) => {
          // Ignore error if no process found
          resolve()
        })
      })
    } else {
      // Linux/Mac: kill all frpc processes
      return new Promise((resolve) => {
        exec('pkill -f frpc', (error) => {
          // Ignore error if no process found
          resolve()
        })
      })
    }
  } catch (error) {
    // Failed to kill existing processes
  }
}

// Start Tunnel Client (FRP)
async function startTunnel() {
  try {
    // 0. Kill existing frpc processes first
    await killExistingFrpcProcesses()
    await new Promise(resolve => setTimeout(resolve, 1000)) // Wait 1 second
    
    // 1. Get machine ID
    const machineId = await getOrCreateMachineId()
    currentMachineId = machineId
    
    // 2. Get API port
    const backendRequire = createRequire(import.meta.url)
    const currentProjectRoot = app.isPackaged ? projectRoot : path.join(__dirname, '..')
    const config = backendRequire(path.join(currentProjectRoot, 'src', 'config.js'))
    const apiPort = config.port || 3000
    
    // 3. Generate frpc.toml config
    const frpcConfig = await generateFrpcConfig(machineId, apiPort)
    const configPath = path.join(os.tmpdir(), `frpc-${machineId}.toml`)
    fs.writeFileSync(configPath, frpcConfig, 'utf8')
    
    // 4. Find frpc executable
    const frpcPath = getFrpcExecutable()
    if (!frpcPath) {
      return
    }
    
    // 5. Spawn frpc process
    const { spawn } = await import('node:child_process')
    
    tunnelProcess = spawn(frpcPath, ['-c', configPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: false,
      cwd: path.dirname(frpcPath),
      env: {
        ...process.env,
      }
    })
    
    // 6. Handle stdout - parse public URL
    tunnelProcess.stdout.on('data', (data) => {
      const msg = data.toString()
      const lines = msg.split('\n').filter(line => line.trim())
      
      for (const line of lines) {
        // Check connection status
        if (line.includes('login to server success') || line.includes('login success')) {
          tunnelConnected = true
        }
        
        // Check proxy start success
        if (line.includes('start proxy') && (line.includes('success') || line.includes('successfully'))) {
          tunnelConnected = true
          
          // Try to extract URL from line or construct from config
          const urlMatch = line.match(/https?:\/\/[^\s]+/i)
          if (urlMatch) {
            tunnelUrl = urlMatch[0]
          } else {
            // Construct URL from config
            const serverAddr = getFrpServerAddr()
            const subdomain = getFrpSubdomain() || machineId.replace(/[^a-zA-Z0-9-]/g, '-')
            // Check if server has domain or use IP
            if (serverAddr.includes('.')) {
              // Assume it's a domain if it has dots and looks like domain
              const isDomain = /^[a-zA-Z0-9][a-zA-Z0-9-]*[a-zA-Z0-9]*\.[a-zA-Z]{2,}$/.test(serverAddr)
              if (isDomain) {
                tunnelUrl = `http://${subdomain}.${serverAddr}`
              } else {
                // IP address - check if subdomain host is configured
                const subdomainHost = getFrpSubdomainHost()
                tunnelUrl = `http://${subdomain}.${subdomainHost}`
              }
            } else {
              tunnelUrl = `http://${serverAddr}/${subdomain}`
            }
          }
          
          // Register machine with backend và update tunnel URL (async, không await)
          if (tunnelUrl && currentMachineId) {
            // Register machine first
            registerMachineWithBackend(currentMachineId, os.hostname()).then(boxId => {
              // Machine registered silently
            }).catch(err => {
              // Failed to register silently
            })
            // Update tunnel URL
            updateTunnelUrlToBackend(currentMachineId, tunnelUrl).then(() => {
              // Tunnel URL updated silently
            }).catch(err => {
              // Failed to update tunnel URL silently
            })
          }
        }
        
        // Check for errors
        if (line.includes('login to server failed') || 
            line.includes('start proxy failed') ||
            (line.includes('error') && !line.includes('success'))) {
          tunnelConnected = false
        }
      }
    })
    
    // 7. Handle stderr
    tunnelProcess.stderr.on('data', (data) => {
      const msg = data.toString()
      const lines = msg.split('\n').filter(line => line.trim())
      
      for (const line of lines) {
        // Check for errors
        if (line.includes('error') || line.includes('failed') || line.includes('dial tcp')) {
          tunnelConnected = false
        }
      }
    })
    
    // 8. Handle process error (spawn failed)
    tunnelProcess.on('error', (error) => {
      tunnelProcess = null
      tunnelConnected = false
    })
    
    // 9. Handle process exit
    tunnelProcess.on('exit', (code, signal) => {
      tunnelProcess = null
      tunnelConnected = false
      tunnelUrl = null
      
      // Auto restart nếu crash (trừ khi app đang quit)
      if (code !== 0 && code !== null && !isQuitting) {
        setTimeout(() => {
          if (!isQuitting && !app.isQuitting) {
            startTunnel()
          }
        }, 5000)
      }
    })
  } catch (error) {
    // Failed to start tunnel silently
  }
}

// Register machine with backend
async function registerMachineWithBackend(machineId, machineName) {
  try {
    const url = `${getBackendApiUrl()}/api/v1/machines/register`
    const requestBody = {
      machine_id: machineId,
      name: machineName || os.hostname() || 'My Computer'
    }
    
    const apiKey = getBackendApiKey()
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey && { 'X-API-Key': apiKey })
      },
      body: JSON.stringify(requestBody)
    })
    
    
    if (!response.ok) {
      const error = await response.json()
      
      // If machine already exists, that's OK
      if (response.status === 409 || response.status === 200) {
        const boxId = error.box_id || error.data?.box_id
        return boxId
      }
      throw new Error(error.error || 'Failed to register machine')
    }
    
    const data = await response.json()
    return data.box_id
  } catch (error) {
    return null
  }
}

// Get FRP config from backend
async function getFrpConfigFromBackend(machineId) {
  try {
    const apiKey = getBackendApiKey()
    const response = await fetch(`${getBackendApiUrl()}/api/v1/machines/${machineId}/frp-config`, {
      method: 'GET',
      headers: {
        ...(apiKey && { 'X-API-Key': apiKey })
      }
    })
    
    if (!response.ok) {
      throw new Error('Failed to get FRP config')
    }
    
    return await response.json()
  } catch (error) {
    console.error('Failed to get FRP config:', error)
    return null
  }
}

// Update tunnel URL to backend
async function updateTunnelUrlToBackend(machineId, tunnelUrl) {
  try {
    const url = `${getBackendApiUrl()}/api/v1/machines/${machineId}/tunnel-url`
    const requestBody = {
      tunnel_url: tunnelUrl
    }
    
    const apiKey = getBackendApiKey()
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey && { 'X-API-Key': apiKey })
      },
      body: JSON.stringify(requestBody)
    })
    
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))
      throw new Error('Failed to update tunnel URL')
    }
    
    const data = await response.json()
    return data
  } catch (error) {
    return null
  }
}

// Send heartbeat to backend
async function sendHeartbeatToBackend(machineId, tunnelUrl, tunnelConnected, apiRunning, apiPort) {
  try {
    const url = `${getBackendApiUrl()}/api/v1/machines/${machineId}/heartbeat`
    const requestBody = {
      tunnel_url: tunnelUrl || '',
      tunnel_connected: tunnelConnected,
      api_running: apiRunning,
      api_port: apiPort
    }
    
    const apiKey = getBackendApiKey()
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey && { 'X-API-Key': apiKey })
      },
      body: JSON.stringify(requestBody)
    })
    
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))
      console.log('[Heartbeat] Error Response:', JSON.stringify(errorData, null, 2))
      throw new Error('Failed to send heartbeat')
    }
    
    const data = await response.json()
    console.log('[Heartbeat] Success Response:', JSON.stringify(data, null, 2))
    return data
  } catch (error) {
    console.error('[Heartbeat] Exception:', error.message)
    return null
  }
}

function createWindow() {
  win = new BrowserWindow({
    icon: path.join(process.env.VITE_PUBLIC, 'electron-vite.svg'),
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  // Ẩn menu bar hoàn toàn
  win.setMenuBarVisibility(false)
  win.setMenu(null)

  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', (new Date).toLocaleString())
  })

  // Open DevTools in development mode
  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
    // Auto open DevTools in dev mode
    win.webContents.openDevTools()
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

// Get prompts file path
function getPromptsFilePath() {
  // Default to Automation_Profiles folder
  const defaultPath = path.join(os.homedir(), 'AppData', 'Local', 'Automation_Profiles')
  return path.join(defaultPath, 'prompts.json')
}

// Read prompts from file
function readPromptsFile() {
  try {
    const filePath = getPromptsFilePath()
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf8')
      return JSON.parse(data)
    }
  } catch (error) {
    // Error reading prompts file
  }
  return { notebookLM: '', gemini: '' }
}

// Write prompts to file
function writePromptsFile(prompts) {
  try {
    const filePath = getPromptsFilePath()
    const dir = path.dirname(filePath)
    
    // Create directory if it doesn't exist
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    
    // Write file
    fs.writeFileSync(filePath, JSON.stringify(prompts, null, 2), 'utf8')
    return { success: true, path: filePath }
  } catch (error) {
    throw error
  }
}

// Sau khi có machine ID (trong startTunnel hoặc getOrCreateMachineId)
async function initializeLogService() {
  const machineId = await getOrCreateMachineId();
  logService.setMachineId(machineId);
  await logService.initialize();
}

// IPC Handlers for prompts
ipcMain.handle('prompts:get', async () => {
  return readPromptsFile()
})

ipcMain.handle('prompts:save', async (event, prompts) => {
  try {
    return writePromptsFile(prompts)
  } catch (error) {
    return { success: false, error: error.message }
  }
})

// Read Google account from file
function readGoogleAccountFile() {
  try {
    const filePath = path.join(os.homedir(), 'AppData', 'Local', 'Automation_Profiles', 'google-account.json')
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf8')
      return JSON.parse(data)
    }
  } catch (error) {
    // Error reading file
  }
  // Fallback to constants from .env
  if (constants && constants.ACCOUNT_GOOGLE && constants.ACCOUNT_GOOGLE.length > 0) {
    const account = constants.ACCOUNT_GOOGLE[0]
    return {
      email: account.email || '',
      password: account.password || ''
    }
  }
  return { email: '', password: '' }
}

// IPC Handlers for Google Account
ipcMain.handle('google-account:get', async () => {
  try {
    return readGoogleAccountFile()
  } catch (error) {
    writeLog('error', 'Failed to get Google account', { error: error.message })
    return { email: '', password: '' }
  }
})

// IPC Handler for Machine ID
ipcMain.handle('machine-id:get', async () => {
  try {
    const machineId = await getOrCreateMachineId()
    const machineIdFile = path.join(os.homedir(), '.automation-machine-id')
    return {
      machineId,
      filePath: machineIdFile
    }
  } catch (error) {
    writeLog('error', 'Failed to get machine ID', { error: error.message })
    return {
      machineId: '',
      filePath: ''
    }
  }
})

// IPC Handler for clipboard
ipcMain.handle('clipboard:write', async (event, text) => {
  const { clipboard } = require('electron')
  clipboard.writeText(text)
  return { success: true }
})

// IPC Handlers for API status
ipcMain.handle('api:status', async () => {
  try {
    const backendRequire = createRequire(import.meta.url)
    const projectRoot = path.join(__dirname, '..')
    const config = backendRequire(path.join(projectRoot, 'src', 'config.js'))
    return {
      running: !!apiServer,
      port: config.port
    }
  } catch (error) {
    return {
      running: false,
      port: 3000,
      error: error.message
    }
  }
})

// IPC Handlers for Tunnel status
ipcMain.handle('tunnel:status', async () => {
  return {
    running: !!tunnelProcess,
    connected: tunnelConnected,
    url: tunnelUrl || null
  }
})

// IPC Handlers for Auto-updater
if (app.isPackaged) {
  ipcMain.handle('updater:check', async () => {
    try {
      const result = await autoUpdater.checkForUpdates()
      return { success: true, updateInfo: result?.updateInfo }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })
  
  ipcMain.handle('updater:quit-and-install', () => {
    autoUpdater.quitAndInstall(false, true)
  })
}

// Track if app is quitting
let isQuitting = false
app.isQuitting = false

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    isQuitting = true
    app.isQuitting = true
    app.quit()
    win = null
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

// Auto-updater configuration
if (app.isPackaged) {
  // Auto-updater sẽ tự động đọc config từ electron-builder.json5
  // Nếu cần override, có thể set như sau:
  // autoUpdater.setFeedURL({
  //   provider: 'github',
  //   owner: process.env.GITHUB_OWNER || 'YOUR_GITHUB_USERNAME',
  //   repo: process.env.GITHUB_REPO || 'YOUR_REPO_NAME'
  // })
  
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  
  autoUpdater.on('checking-for-update', () => {
    writeLog('info', 'Checking for updates...')
  })
  
  autoUpdater.on('update-available', (info) => {
    writeLog('info', 'Update available', { version: info.version })
    if (win) {
      win.webContents.send('update-available', info)
    }
  })
  
  autoUpdater.on('update-not-available', (info) => {
    writeLog('info', 'Update not available', { version: info.version })
  })
  
  autoUpdater.on('error', (err) => {
    writeLog('error', 'Error in auto-updater', { error: err.message })
  })
  
  autoUpdater.on('download-progress', (progressObj) => {
    const message = `Download speed: ${progressObj.bytesPerSecond} - Downloaded ${progressObj.percent}% (${progressObj.transferred}/${progressObj.total})`
    writeLog('info', message)
    if (win) {
      win.webContents.send('download-progress', progressObj)
    }
  })
  
  autoUpdater.on('update-downloaded', (info) => {
    writeLog('info', 'Update downloaded', { version: info.version })
    if (win) {
      win.webContents.send('update-downloaded', info)
    }
    // Tự động cài đặt khi app quit (hoặc có thể hỏi user trước)
    // autoUpdater.quitAndInstall(false, true)
  })
  
  // Check for updates khi app khởi động (sau 5 giây)
  setTimeout(() => {
    autoUpdater.checkForUpdatesAndNotify()
  }, 5000)
  
  // Check for updates mỗi 4 giờ
  setInterval(() => {
    autoUpdater.checkForUpdatesAndNotify()
  }, 4 * 60 * 60 * 1000)
}

app.whenReady().then(async () => {
  writeLog('info', 'App is ready, starting initialization...')
  
  // Update paths if needed (for production)
  if (app.isPackaged) {
    const paths = getAppPaths()
    projectRoot = paths.projectRoot
    srcPath = paths.srcPath
    envPath = paths.envPath
    process.env.APP_ROOT = projectRoot
    writeLog('info', 'Paths updated for production', { projectRoot, srcPath, envPath })
  }
  
  // Always load modules in app.whenReady (not at top-level to avoid initialization errors)
  if (!logService || !constants) {
    writeLog('info', 'Loading modules in app.whenReady...')
    try {
      const backendRequire = createRequire(import.meta.url)
      const currentSrcPath = app.isPackaged ? srcPath : path.join(__dirname, '..', 'src')
      logService = backendRequire(path.join(currentSrcPath, 'services', 'logService'))
      constants = backendRequire(path.join(currentSrcPath, 'constants', 'constants'))
      writeLog('success', 'Modules loaded successfully', { srcPath: currentSrcPath })
    } catch (error) {
      writeLog('error', 'Failed to load modules', { error: error.message, stack: error.stack })
      // Don't throw, let app continue with fallback values
    }
  }
  
  // 1. Start API Server first
  writeLog('info', 'Step 1: Starting API Server...')
  await startAPIServer()
  
  // Đợi một chút để đảm bảo server đã sẵn sàng
  await new Promise(resolve => setTimeout(resolve, 500))
  
  // Initialize log service
  writeLog('info', 'Step 2: Initializing log service...')
  try {
    await initializeLogService()
    writeLog('success', 'Log service initialized')
  } catch (error) {
    writeLog('error', 'Failed to initialize log service', { error: error.message })
  }
  
  // 2. Recover monitoring state (sau khi API server start)
  writeLog('info', 'Step 3: Recovering profile monitoring...')
  const backendRequire = createRequire(import.meta.url)
  const currentProjectRoot = app.isPackaged ? projectRoot : path.join(__dirname, '..')
  try {
    const profileMonitorService = backendRequire(path.join(currentProjectRoot, 'src', 'services', 'profileMonitor.js'))
    setTimeout(async () => {
      try {
        await profileMonitorService.recoverMonitoring()
        writeLog('success', 'Profile monitoring recovered')
      } catch (error) {
        writeLog('error', 'Failed to recover profile monitoring', { error: error.message })
      }
    }, 2000)
  } catch (error) {
    writeLog('error', 'Error loading profile monitor service', { error: error.message })
  }
  
  // 3. Start Tunnel Client
  startTunnel()
  
  // 4. Create Window (sau khi server đã start)
  writeLog('info', 'Step 5: Creating window...')
  createWindow()
  
  // 5. Start heartbeat interval (gửi mỗi 30 giây)
  writeLog('info', 'Step 6: Setting up heartbeat interval...')
  try {
    const config = backendRequire(path.join(currentProjectRoot, 'src', 'config.js'))
    const apiPort = config.port || 3000
    
    heartbeatInterval = setInterval(async () => {
      if (currentMachineId) {
        await sendHeartbeatToBackend(
          currentMachineId,
          tunnelUrl || '',
          tunnelConnected,
          !!apiServer,
          apiPort
        )
      }
    }, 30000) // 30 seconds
    writeLog('success', 'Heartbeat interval started (30s)')
  } catch (error) {
    writeLog('error', 'Failed to setup heartbeat', { error: error.message })
  }
  
  writeLog('success', '✅ App initialization completed')
  
  // Register keyboard shortcuts for DevTools
  // F12 or Ctrl+Shift+I to toggle DevTools
  globalShortcut.register('F12', () => {
    if (win) {
      if (win.webContents.isDevToolsOpened()) {
        win.webContents.closeDevTools()
      } else {
        win.webContents.openDevTools()
      }
    }
  })
  
  globalShortcut.register('CommandOrControl+Shift+I', () => {
    if (win) {
      if (win.webContents.isDevToolsOpened()) {
        win.webContents.closeDevTools()
      } else {
        win.webContents.openDevTools()
      }
    }
  })
})

// Cleanup on quit
app.on('will-quit', async (event) => {
  globalShortcut.unregisterAll()
  
  // Clear heartbeat interval
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval)
    heartbeatInterval = null
  }
  
  // Stop all profile monitoring
  try {
    const backendRequire = createRequire(import.meta.url)
    const projectRoot = path.join(__dirname, '..')
    const profileMonitorService = backendRequire(path.join(projectRoot, 'src', 'services', 'profileMonitor.js'))
    await profileMonitorService.stopAll()
  } catch (error) {
    // Ignore error
  }
  
  // Close API server gracefully
  if (apiServer) {
    return new Promise((resolve) => {
      apiServer.close(() => {
        // Kill tunnel process
        if (tunnelProcess) {
          try {
            tunnelProcess.kill('SIGTERM')
            setTimeout(() => {
              if (tunnelProcess && !tunnelProcess.killed) {
                tunnelProcess.kill('SIGKILL')
              }
              resolve()
            }, 1000)
          } catch (error) {
            resolve()
          }
        } else {
          resolve()
        }
      })
      
      setTimeout(() => {
        resolve()
      }, 3000)
    })
  } else {
    if (tunnelProcess) {
      try {
        tunnelProcess.kill('SIGTERM')
      } catch (error) {
        // Ignore
      }
    }
  }
})
