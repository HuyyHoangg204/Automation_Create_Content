/**
 * API functions for Electron IPC communication
 * Các hàm giao tiếp với Electron main process
 */

/**
 * Send message to main process
 * @param {string} channel - IPC channel name
 * @param {any} data - Data to send
 * @returns {Promise<any>} Response from main process
 */
export async function sendToMain(channel, data) {
  if (window.ipcRenderer) {
    return await window.ipcRenderer.invoke(channel, data)
  }
  throw new Error('IPC Renderer is not available')
}

/**
 * Listen to messages from main process
 * @param {string} channel - IPC channel name
 * @param {Function} callback - Callback function
 */
export function listenFromMain(channel, callback) {
  if (window.ipcRenderer) {
    window.ipcRenderer.on(channel, (event, ...args) => {
      callback(...args)
    })
  }
}

/**
 * Remove listener from main process
 * @param {string} channel - IPC channel name
 * @param {Function} callback - Callback function
 */
export function removeListener(channel, callback) {
  if (window.ipcRenderer) {
    window.ipcRenderer.off(channel, callback)
  }
}

