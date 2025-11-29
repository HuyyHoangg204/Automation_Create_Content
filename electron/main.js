import { app, BrowserWindow, globalShortcut, ipcMain } from 'electron'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { randomUUID } from 'node:crypto'

// Phải định nghĩa require trước khi sử dụng
const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Load logService sau khi createRequire đã được định nghĩa
const logService = require('../src/services/logService');

process.env.APP_ROOT = path.join(__dirname, '..')

export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

// Backend API Configuration
const BACKEND_API_URL = process.env.BACKEND_API_URL || 'http://localhost:8080'
const BACKEND_API_KEY = process.env.BACKEND_API_KEY || ''

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
    // Use createRequire to load CommonJS modules from src/
    // src/ has its own package.json with "type": "commonjs" to override parent
    const backendRequire = createRequire(import.meta.url)
    const projectRoot = path.join(__dirname, '..')
    const srcPath = path.join(projectRoot, 'src')
    
    // Load CommonJS modules directly
    // src/package.json with "type": "commonjs" makes these files CommonJS
    const backend = backendRequire(path.join(srcPath, 'index.js'))
    const config = backendRequire(path.join(srcPath, 'config.js'))
    const { createApp } = backend
    const { port } = config
    
    const expressApp = await createApp()
    apiServer = expressApp.listen(port, '127.0.0.1', () => {
    })
  } catch (error) {
    console.error('[API Server] ❌ Failed to start:', error)
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
  
  // Get real machine ID from system first (don't read file first)
  let machineId = null
  
  // 1. Try Windows Machine GUID (UUID format) - most reliable
  if (process.platform === 'win32') {
    const guid = await getWindowsMachineGuid()
    if (guid) {
      // Format: {machine-guid} (remove dashes for shorter subdomain, no prefix)
      machineId = guid.replace(/-/g, '')
    }
  }
  
  // Check existing file - only use if it's Machine GUID format (32 hex chars)
  try {
    if (fs.existsSync(machineIdFile)) {
      const existingId = fs.readFileSync(machineIdFile, 'utf8').trim()
      // Check if existing ID is Machine GUID format ({32hex} or xeon-{32hex})
      const isGuidFormat = /^[a-f0-9]{32}$/i.test(existingId) || /^xeon-[a-f0-9]{32}$/i.test(existingId)
      
      if (isGuidFormat) {
        // Existing ID is GUID format, use it (remove xeon- prefix if present)
        const cleanId = existingId.replace(/^xeon-/, '')
        return cleanId
      }
    }
  } catch (_) {
    // Ignore
  }
  
  // 2. If Machine GUID not available, try hostname
  if (!machineId) {
    machineId = os.hostname()
    if (machineId && machineId !== 'localhost' && machineId.trim() !== '') {
      // Sanitize hostname: remove invalid chars, lowercase (no prefix)
      machineId = machineId.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
    }
  }
  
  // 3. If hostname not available, try MAC address
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
  
  // 4. Fallback: use random UUID only if all above failed
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
  // Get config from env or use defaults
  const serverAddr = process.env.FRP_SERVER_ADDR || '158.69.59.214'
  const serverPort = process.env.FRP_SERVER_PORT || '7000'
  const authToken = process.env.FRP_AUTH_TOKEN || 'your_secure_token_12345'
  const subdomain = process.env.FRP_SUBDOMAIN || machineId.replace(/[^a-zA-Z0-9-]/g, '-')
  
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
  
  // Get project root (works for both dev and build)
  // In dev: __dirname = electron/
  // In build: __dirname = dist-electron/
  // We need to go up to project root
  const projectRoot = path.join(__dirname, '..')
  
  // Try multiple locations (order matters)
  const possiblePaths = [
    // 1. electron/tunnel/ (dev mode)
    path.join(projectRoot, 'electron', 'tunnel', exeName),
    // 2. dist-electron/tunnel/ (build mode - if copied)
    path.join(__dirname, 'tunnel', exeName),
    // 3. frp_0.65.0_windows_amd64/ (fallback)
    path.join(projectRoot, 'frp_0.65.0_windows_amd64', exeName),
    // 4. resources/electron/tunnel/ (packaged app)
    path.join(process.resourcesPath || projectRoot, 'electron', 'tunnel', exeName),
    // 5. app.asar.unpacked/electron/tunnel/ (if unpacked)
    path.join(projectRoot, '..', 'app.asar.unpacked', 'electron', 'tunnel', exeName),
  ]
  
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
    const projectRoot = path.join(__dirname, '..')
    const config = backendRequire(path.join(projectRoot, 'src', 'config.js'))
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
            const serverAddr = process.env.FRP_SERVER_ADDR || '158.69.59.214'
            const subdomain = process.env.FRP_SUBDOMAIN || machineId.replace(/[^a-zA-Z0-9-]/g, '-')
            // Check if server has domain or use IP
            if (serverAddr.includes('.')) {
              // Assume it's a domain if it has dots and looks like domain
              const isDomain = /^[a-zA-Z0-9][a-zA-Z0-9-]*[a-zA-Z0-9]*\.[a-zA-Z]{2,}$/.test(serverAddr)
              if (isDomain) {
                tunnelUrl = `http://${subdomain}.${serverAddr}`
              } else {
                // IP address - check if subdomain host is configured
                const subdomainHost = process.env.FRP_SUBDOMAIN_HOST || 'autogencontent.xyz'
                tunnelUrl = `http://${subdomain}.${subdomainHost}`
              }
            } else {
              tunnelUrl = `http://${serverAddr}/${subdomain}`
            }
          }
          
          // Register machine with backend và update tunnel URL (async, không await)
          if (tunnelUrl && currentMachineId) {
            // Register machine first
            registerMachineWithBackend(currentMachineId, os.hostname()).catch(err => {
              console.error('Failed to register machine:', err)
            })
            // Update tunnel URL
            updateTunnelUrlToBackend(currentMachineId, tunnelUrl).catch(err => {
              console.error('Failed to update tunnel URL:', err)
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
    // Failed to start tunnel
  }
}

// Register machine with backend
async function registerMachineWithBackend(machineId, machineName) {
  try {
    const response = await fetch(`${BACKEND_API_URL}/api/v1/machines/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(BACKEND_API_KEY && { 'X-API-Key': BACKEND_API_KEY })
      },
      body: JSON.stringify({
        machine_id: machineId,
        name: machineName || os.hostname() || 'My Computer'
      })
    })
    
    if (!response.ok) {
      const error = await response.json()
      // If machine already exists, that's OK
      if (response.status === 409 || response.status === 200) {
        return error.box_id || (await response.json()).box_id
      }
      throw new Error(error.error || 'Failed to register machine')
    }
    
    const data = await response.json()
    return data.box_id
  } catch (error) {
    console.error('Failed to register machine:', error)
    return null
  }
}

// Get FRP config from backend
async function getFrpConfigFromBackend(machineId) {
  try {
    const response = await fetch(`${BACKEND_API_URL}/api/v1/machines/${machineId}/frp-config`, {
      method: 'GET',
      headers: {
        ...(BACKEND_API_KEY && { 'X-API-Key': BACKEND_API_KEY })
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
    const response = await fetch(`${BACKEND_API_URL}/api/v1/machines/${machineId}/tunnel-url`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...(BACKEND_API_KEY && { 'X-API-Key': BACKEND_API_KEY })
      },
      body: JSON.stringify({
        tunnel_url: tunnelUrl
      })
    })
    
    if (!response.ok) {
      throw new Error('Failed to update tunnel URL')
    }
    
    return await response.json()
  } catch (error) {
    console.error('Failed to update tunnel URL:', error)
    return null
  }
}

// Send heartbeat to backend
async function sendHeartbeatToBackend(machineId, tunnelUrl, tunnelConnected, apiRunning, apiPort) {
  try {
    const response = await fetch(`${BACKEND_API_URL}/api/v1/machines/${machineId}/heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(BACKEND_API_KEY && { 'X-API-Key': BACKEND_API_KEY })
      },
      body: JSON.stringify({
        tunnel_url: tunnelUrl || '',
        tunnel_connected: tunnelConnected,
        api_running: apiRunning,
        api_port: apiPort
      })
    })
    
    if (!response.ok) {
      throw new Error('Failed to send heartbeat')
    }
    
    return await response.json()
  } catch (error) {
    console.error('Failed to send heartbeat:', error)
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

app.whenReady().then(async () => {
  // 1. Start API Server first
  await startAPIServer()
  
  // Đợi một chút để đảm bảo server đã sẵn sàng
  await new Promise(resolve => setTimeout(resolve, 500))
  
  await initializeLogService();
  
  // 2. Recover monitoring state (sau khi API server start)
  const backendRequire = createRequire(import.meta.url)
  const projectRoot = path.join(__dirname, '..')
  try {
    const profileMonitorService = backendRequire(path.join(projectRoot, 'src', 'services', 'profileMonitor.js'))
    setTimeout(async () => {
      await profileMonitorService.recoverMonitoring()
    }, 2000)
  } catch (error) {
    console.error('[ProfileMonitor] Error recovering:', error)
  }
  
  // 3. Start Tunnel Client
  startTunnel()
  
  // 4. Create Window (sau khi server đã start)
  createWindow()
  
  // 5. Start heartbeat interval (gửi mỗi 30 giây)
  const config = backendRequire(path.join(projectRoot, 'src', 'config.js'))
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
