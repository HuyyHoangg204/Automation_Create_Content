<template>
  <MainLayout>
    <Header />
    
    <div class="flex-1 overflow-auto p-6">
      <div class="max-w-4xl mx-auto">
        <h1 class="text-2xl font-bold text-white mb-6">Settings</h1>
        
        <!-- Profile Storage Settings -->
        <div class="bg-[#0d1b2a] rounded-lg border border-gray-800 p-6 mb-6">
          <h2 class="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
            Profile Storage
          </h2>
          
          <div class="space-y-4">
            <div>
              <label class="block text-sm font-medium text-gray-400 mb-2">
                Profiles Directory
              </label>
              <div class="flex gap-3">
                <input 
                  type="text" 
                  v-model="profilesDirectory"
                  readonly
                  :disabled="isLoading"
                  class="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-sm text-gray-300 focus:outline-none focus:border-blue-500 disabled:opacity-50"
                  placeholder="Loading..."
                />
                <button 
                  @click="selectDirectory"
                  :disabled="isLoading"
                  class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                  </svg>
                  Browse
                </button>
              </div>
              <p class="text-xs text-gray-500 mt-2">
                This is where Chrome profiles will be stored. Each profile is a separate folder.
              </p>
            </div>
            
            <div class="flex items-center justify-between pt-4 border-t border-gray-800">
              <div>
                <p class="text-sm font-medium text-white">Current Location</p>
                <p class="text-xs text-gray-500 mt-1">{{ profilesDirectory || 'Default location' }}</p>
              </div>
              <button 
                @click="resetToDefault"
                :disabled="isLoading"
                class="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Reset to Default
              </button>
            </div>
          </div>
        </div>
        
        <!-- Machine ID Settings -->
        <div class="bg-[#0d1b2a] rounded-lg border border-gray-800 p-6 mb-6">
          <h2 class="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
            Machine ID
          </h2>
          
          <div class="space-y-4">
            <div>
              <label class="block text-sm font-medium text-gray-400 mb-2">
                Machine Identifier
              </label>
              <input
                type="text"
                v-model="machineId"
                readonly
                :disabled="isLoading"
                class="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-sm text-gray-300 font-mono focus:outline-none focus:border-blue-500 disabled:opacity-50"
                placeholder="Loading machine ID..."
              />
              <p class="text-xs text-gray-500 mt-2">
                Unique identifier for this machine. Used for FRP tunnel and backend registration.
              </p>
            </div>
            
            <div class="flex items-center justify-between pt-4 border-t border-gray-800">
              <div>
                <p class="text-sm font-medium text-white">File Location</p>
                <p class="text-xs text-gray-500 mt-1">{{ machineIdFile || 'Not loaded' }}</p>
              </div>
              <button
                @click="copyMachineId"
                :disabled="!machineId || isLoading"
                class="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                Copy ID
              </button>
            </div>
          </div>
        </div>
        
        <!-- Google Account Settings -->
        <div class="bg-[#0d1b2a] rounded-lg border border-gray-800 p-6">
          <h2 class="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            Google Account Configuration
          </h2>
          
          <div class="space-y-6">
            <!-- Google Email -->
            <div>
              <label class="flex text-sm font-medium text-gray-400 mb-2 items-center gap-2">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                Google Account Email
              </label>
              <input
                v-model="googleEmail"
                type="email"
                placeholder="Enter your Google account email..."
                class="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-sm text-gray-300 placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
              <p class="text-xs text-gray-500 mt-2">
                Email address for Google account (default from .env file).
              </p>
            </div>

            <!-- Google Password -->
            <div>
              <label class="flex text-sm font-medium text-gray-400 mb-2 items-center gap-2">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
                Google Account Password
              </label>
              <input
                v-model="googlePassword"
                type="password"
                placeholder="Enter your Google account password..."
                class="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-sm text-gray-300 placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
              <p class="text-xs text-gray-500 mt-2">
                Password for Google account (default from .env file).
              </p>
            </div>

            <!-- Save Button -->
            <div class="flex justify-end pt-4 border-t border-gray-800">
              <button
                @click="saveGoogleAccount"
                :disabled="isSaving"
                class="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <svg v-if="!isSaving" class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                </svg>
                <svg v-else class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                {{ isSaving ? 'Saving...' : 'Save Account' }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </MainLayout>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useToast } from 'primevue/usetoast'
import MainLayout from '@/layouts/MainLayout.vue'
import Header from '@/components/Header.vue'
import { ProfileAPI } from '@/api/profile.js'

const toast = useToast()
const profilesDirectory = ref('')
const isLoading = ref(false)

// Google Account
const googleEmail = ref('')
const googlePassword = ref('')
const isSaving = ref(false)

// Machine ID
const machineId = ref('')
const machineIdFile = ref('')

onMounted(async () => {
  await loadSettings()
  await loadMachineId()
})

async function loadSettings() {
  try {
    isLoading.value = true
    
    // Load profiles folder from API
    const folderResult = await ProfileAPI.getProfilesFolder()
    console.log('Folder result:', folderResult)
    
    // Handle different response formats
    if (folderResult) {
      // Try different possible field names
      profilesDirectory.value = folderResult.folder || 
                                 folderResult.profilesBaseDir || 
                                 folderResult.path || 
                                 folderResult.directory || 
                                 ''
      
      if (!profilesDirectory.value) {
        console.warn('Unknown response format:', folderResult)
      }
    }
    
    // Load Google account from file or .env
    await loadGoogleAccount()
  } catch (error) {
    console.error('Failed to load settings:', error)
    toast.add({
      severity: 'error',
      summary: 'Load Failed',
      detail: error.message || 'Failed to load settings',
      life: 3000
    })
  } finally {
    isLoading.value = false
  }
}

async function selectDirectory() {
  try {
    // Use Electron dialog to select directory
    if (!window.ipcRenderer) {
      toast.add({
        severity: 'error',
        summary: 'Not Available',
        detail: 'Directory selection requires Electron',
        life: 3000
      })
      return
    }
    
    const result = await window.ipcRenderer.invoke('select-directory')
    
    if (result.success && result.path) {
      // Set folder via API
      const apiResult = await ProfileAPI.setProfilesFolder(result.path)
      console.log('Set folder result:', apiResult)
      
      // Update with response from API or use selected path
      profilesDirectory.value = apiResult?.folder || 
                                 apiResult?.profilesBaseDir || 
                                 apiResult?.path || 
                                 result.path
      
      toast.add({
        severity: 'success',
        summary: 'Directory Updated',
        detail: `Profiles will be saved to: ${result.path}`,
        life: 3000
      })
    } else if (result.cancelled) {
      toast.add({
        severity: 'info',
        summary: 'Cancelled',
        detail: 'No directory selected',
        life: 2000
      })
    }
  } catch (error) {
    toast.add({
      severity: 'error',
      summary: 'Error',
      detail: error.message || 'Failed to set directory',
      life: 3000
    })
  }
}

async function resetToDefault() {
  try {
    isLoading.value = true
    
    // Get default folder path (platform-specific)
    // Windows: AppData\Local\Automation_Profiles
    // macOS: ~/Library/Application Support/Automation_Profiles
    // Linux: ~/.config/automation_profiles
    
    // For now, we'll set an empty string and let backend handle default
    // Or you can specify the default path based on platform
    const defaultPath = '' // Backend will use platform default
    
    const result = await ProfileAPI.setProfilesFolder(defaultPath)
    console.log('Reset result:', result)
    
    // Handle different response formats
    if (result) {
      profilesDirectory.value = result.folder || 
                                 result.profilesBaseDir || 
                                 result.path || 
                                 result.directory || 
                                 ''
      
      toast.add({
        severity: 'success',
        summary: 'Reset Successful',
        detail: `Profiles directory reset to default: ${profilesDirectory.value}`,
        life: 3000
      })
    }
  } catch (error) {
    toast.add({
      severity: 'error',
      summary: 'Error',
      detail: error.message || 'Failed to reset directory',
      life: 3000
    })
  } finally {
    isLoading.value = false
  }
}

// Load Google account from file or .env
async function loadGoogleAccount() {
  try {
    if (window.ipcRenderer) {
      const account = await window.ipcRenderer.invoke('google-account:get')
      googleEmail.value = account.email || ''
      googlePassword.value = account.password || ''
    } else {
      // Fallback to localStorage if IPC not available
      const savedEmail = localStorage.getItem('google_account_email')
      const savedPassword = localStorage.getItem('google_account_password')
      
      if (savedEmail) {
        googleEmail.value = savedEmail
      }
      if (savedPassword) {
        googlePassword.value = savedPassword
      }
    }
  } catch (error) {
    console.error('Error loading Google account:', error)
    toast.add({
      severity: 'warn',
      summary: 'Load Failed',
      detail: 'Using default account from .env. Error: ' + error.message,
      life: 3000
    })
  }
}

// Load Machine ID
async function loadMachineId() {
  try {
    if (window.ipcRenderer) {
      const result = await window.ipcRenderer.invoke('machine-id:get')
      machineId.value = result.machineId || ''
      machineIdFile.value = result.filePath || ''
    } else {
      machineId.value = 'Not available (IPC not available)'
    }
  } catch (error) {
    console.error('Error loading machine ID:', error)
    machineId.value = 'Error loading machine ID'
    toast.add({
      severity: 'warn',
      summary: 'Load Failed',
      detail: 'Failed to load machine ID: ' + error.message,
      life: 3000
    })
  }
}

// Copy Machine ID to clipboard
async function copyMachineId() {
  try {
    if (!machineId.value) return
    
    if (window.ipcRenderer) {
      await window.ipcRenderer.invoke('clipboard:write', machineId.value)
    } else if (navigator.clipboard) {
      await navigator.clipboard.writeText(machineId.value)
    } else {
      // Fallback: select text
      const input = document.createElement('input')
      input.value = machineId.value
      document.body.appendChild(input)
      input.select()
      document.execCommand('copy')
      document.body.removeChild(input)
    }
    
    toast.add({
      severity: 'success',
      summary: 'Copied',
      detail: 'Machine ID copied to clipboard',
      life: 2000
    })
  } catch (error) {
    console.error('Error copying machine ID:', error)
    toast.add({
      severity: 'error',
      summary: 'Copy Failed',
      detail: error.message || 'Failed to copy machine ID',
      life: 3000
    })
  }
}
</script>

