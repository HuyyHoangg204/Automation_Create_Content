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
        
        <!-- AI Prompts Settings -->
        <div class="bg-[#0d1b2a] rounded-lg border border-gray-800 p-6">
          <h2 class="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
            AI Prompts Configuration
          </h2>
          
          <div class="space-y-6">
            <!-- NotebookLM Prompt -->
            <div>
              <label class="flex text-sm font-medium text-gray-400 mb-2 items-center gap-2">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                NotebookLM Prompt
              </label>
              <textarea
                v-model="notebookLMPrompt"
                rows="6"
                placeholder="Enter your NotebookLM prompt template here..."
                class="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-sm text-gray-300 placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 resize-y font-mono"
              ></textarea>
              <p class="text-xs text-gray-500 mt-2">
                This prompt will be used when generating content with NotebookLM.
              </p>
            </div>

            <!-- Gemini Prompt -->
            <div>
              <label class="flex text-sm font-medium text-gray-400 mb-2 items-center gap-2">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
                Gemini Prompt
              </label>
              <textarea
                v-model="geminiPrompt"
                rows="6"
                placeholder="Enter your Gemini prompt template here..."
                class="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-sm text-gray-300 placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 resize-y font-mono"
              ></textarea>
              <p class="text-xs text-gray-500 mt-2">
                This prompt will be used when generating content with Google Gemini.
              </p>
            </div>

            <!-- Save Button -->
            <div class="flex justify-end pt-4 border-t border-gray-800">
              <button
                @click="savePrompts"
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
                {{ isSaving ? 'Saving...' : 'Save Prompts' }}
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

// AI Prompts
const notebookLMPrompt = ref('')
const geminiPrompt = ref('')
const isSaving = ref(false)

onMounted(async () => {
  await loadSettings()
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
    
    // Load AI prompts from file
    await loadPrompts()
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

// Load prompts from file (C:\Users\tranh\AppData\Local\Automation_Profiles\prompts.json)
async function loadPrompts() {
  try {
    if (window.ipcRenderer) {
      const prompts = await window.ipcRenderer.invoke('prompts:get')
      notebookLMPrompt.value = prompts.notebookLM || ''
      geminiPrompt.value = prompts.gemini || ''
    } else {
      // Fallback to localStorage if IPC not available
      const savedNotebookLM = localStorage.getItem('notebooklm_prompt')
      const savedGemini = localStorage.getItem('gemini_prompt')
      
      if (savedNotebookLM) {
        notebookLMPrompt.value = savedNotebookLM
      }
      if (savedGemini) {
        geminiPrompt.value = savedGemini
      }
    }
  } catch (error) {
    console.error('Error loading prompts:', error)
    toast.add({
      severity: 'warn',
      summary: 'Load Failed',
      detail: 'Using default prompts. Error: ' + error.message,
      life: 3000
    })
  }
}

// Save prompts to file (C:\Users\tranh\AppData\Local\Automation_Profiles\prompts.json)
async function savePrompts() {
  try {
    isSaving.value = true
    
    if (window.ipcRenderer) {
      // Save to file via IPC
      const result = await window.ipcRenderer.invoke('prompts:save', {
        notebookLM: notebookLMPrompt.value,
        gemini: geminiPrompt.value
      })
      
      if (result.success) {
        toast.add({
          severity: 'success',
          summary: 'Prompts Saved',
          detail: `Prompts saved to: ${result.path}`,
          life: 3000
        })
      } else {
        throw new Error(result.error || 'Failed to save prompts')
      }
    } else {
      // Fallback to localStorage if IPC not available
      localStorage.setItem('notebooklm_prompt', notebookLMPrompt.value)
      localStorage.setItem('gemini_prompt', geminiPrompt.value)
      
      toast.add({
        severity: 'success',
        summary: 'Prompts Saved',
        detail: 'Prompts saved to local storage',
        life: 3000
      })
    }
  } catch (error) {
    console.error('Error saving prompts:', error)
    toast.add({
      severity: 'error',
      summary: 'Save Failed',
      detail: error.message || 'Failed to save prompts',
      life: 3000
    })
  } finally {
    isSaving.value = false
  }
}
</script>

