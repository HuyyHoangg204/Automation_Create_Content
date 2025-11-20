<template>
  <div class="flex-1 overflow-auto bg-[#0a1628]">
    <DataTable 
      :value="profiles" 
      :paginator="false"
      :rows="10"
      dataKey="id"
      class="profile-datatable"
      :pt="{
        root: { class: 'bg-transparent' },
        table: { class: 'w-full' },
        header: { class: 'bg-[#0d1b2a] border-b border-gray-800' },
        thead: { class: 'bg-[#0d1b2a] border-b border-gray-800' },
        tbody: { class: 'divide-y divide-gray-800' },
        bodyRow: { class: 'hover:bg-gray-800/50 transition-colors' }
      }"
    >
      <Column selectionMode="multiple" headerStyle="width: 3rem" />
      
      <Column field="name" header="NAME">
        <template #body="slotProps">
          <div class="flex items-center gap-3">
            <div class="w-8 h-8 bg-blue-600 rounded flex items-center justify-center flex-shrink-0">
              <svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <span class="text-sm font-medium text-white">{{ slotProps.data.name }}</span>
          </div>
        </template>
      </Column>
      
      <Column field="createdAt" header="CREATED AT">
        <template #body="slotProps">
          <span class="text-sm text-gray-300">{{ formatDate(slotProps.data.createdAt) }}</span>
        </template>
      </Column>
      
      <Column field="updatedAt" header="UPDATED AT">
        <template #body="slotProps">
          <span class="text-sm text-gray-300">{{ formatDate(slotProps.data.updatedAt) }}</span>
        </template>
      </Column>
      
      <Column header="ACTION">
        <template #body="slotProps">
          <div class="flex items-center gap-2">
            <button 
              @click="handleProfileAction(slotProps.data)"
              :class="[
                'w-20 px-4 py-1.5 rounded-lg text-xs font-medium transition-all',
                slotProps.data.actionStatus === 'running' 
                  ? 'bg-red-600 hover:bg-red-700 text-white' 
                  : 'bg-green-600 hover:bg-green-700 text-white'
              ]"
            >
              {{ slotProps.data.actionStatus === 'running' ? 'Stop' : 'Launch' }}
            </button>
            <button class="p-1.5 hover:bg-gray-700 rounded transition-colors">
              <svg class="w-5 h-5 text-gray-400" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/>
              </svg>
            </button>
          </div>
        </template>
      </Column>
    </DataTable>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useToast } from 'primevue/usetoast'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import { ProfileAPI } from '@/api/profile.js'

const toast = useToast()

// Load profiles from backend API
async function loadProfiles() {
  try {
    const result = await ProfileAPI.getAll()
    
    if (result && result.profiles) {
      // Map API response to frontend format
      profiles.value = result.profiles.map(p => ({
        id: p.id,
        name: p.name,
        userDataDir: p.userDataDir,
        profileDirName: p.profileDirName,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        actionStatus: 'stopped' // Default: stopped (shows Launch button)
      }))
      
      console.log('✅ Profiles loaded:', profiles.value.length)
    } else {
      console.warn('⚠️ No profiles found in response')
      profiles.value = []
    }
  } catch (error) {
    console.error('❌ Error loading profiles:', error)
    toast.add({
      severity: 'error',
      summary: 'Load Failed',
      detail: error.message || 'Failed to load profiles from server',
      life: 5000
    })
    profiles.value = []
  }
}

// Handle profile action button click
async function handleProfileAction(profile) {
  try {
    if (profile.actionStatus === 'running') {
      // Stop profile
      console.log('⏹️  Stopping profile:', profile.name)
      
      toast.add({
        severity: 'info',
        summary: 'Stopping Profile',
        detail: `Stopping ${profile.name}...`,
        life: 2000
      })
      
      // Call API to stop profile
      const result = await ProfileAPI.stop({
        name: profile.name,
        userDataDir: profile.userDataDir,
        profileDirName: profile.profileDirName,
      })
      
      if (result) {
        // Update status
        profile.actionStatus = 'stopped'
        
        toast.add({
          severity: 'success',
          summary: 'Profile Stopped',
          detail: `Profile "${profile.name}" stopped successfully`,
          life: 3000
        })
      }
    } else {
      // Launch profile
      console.log('🚀 Launching profile:', profile.name)
      
      toast.add({
        severity: 'info',
        summary: 'Launching Profile',
        detail: `Opening ${profile.name}...`,
        life: 2000
      })
      
      // Call API to launch profile
      const result = await ProfileAPI.launch({
        name: profile.name,
        userDataDir: profile.userDataDir,
        profileDirName: profile.profileDirName,
        extraArgs: ['--start-maximized'],
      })
      
      if (result) {
        // Update status
        profile.actionStatus = 'running'
        
        toast.add({
          severity: 'success',
          summary: 'Profile Launched',
          detail: `Profile "${profile.name}" launched successfully`,
          life: 3000
        })
      }
    }
  } catch (error) {
    console.error('❌ Error:', error)
    toast.add({
      severity: 'error',
      summary: 'Error',
      detail: error.message || 'An error occurred',
      life: 5000
    })
  }
}

// Helper: Format date
function formatDate(dateString) {
  if (!dateString) return 'N/A'
  
  try {
    const date = new Date(dateString)
    return date.toLocaleString('vi-VN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
  } catch (error) {
    return dateString
  }
}

// Load profiles on mount
onMounted(() => {
  loadProfiles()
})

// Expose loadProfiles for parent component
defineExpose({
  loadProfiles
})

// Profiles loaded from backend API
const profiles = ref([])
</script>

<style scoped>
:deep(.p-datatable) {
  background: transparent !important;
}

:deep(.p-datatable-wrapper) {
  background: transparent !important;
}

:deep(.p-datatable-table) {
  width: 100%;
  background: transparent !important;
}

:deep(.p-datatable-thead) {
  background: #0d1b2a !important;
}

:deep(.p-datatable-thead > tr) {
  background: #0d1b2a !important;
}

:deep(.p-datatable-thead > tr > th) {
  background: #0d1b2a !important;
  border-bottom: 1px solid rgb(31, 41, 55);
  color: rgb(156, 163, 175);
  padding: 0.75rem 1.5rem;
  text-align: left;
  font-size: 0.75rem;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

:deep(.p-datatable-tbody) {
  background: transparent !important;
}

:deep(.p-datatable-tbody > tr) {
  border-bottom: 1px solid rgb(31, 41, 55);
  transition: background-color 0.2s;
  background: transparent !important;
}

:deep(.p-datatable-tbody > tr:hover) {
  background: rgba(31, 41, 55, 0.5) !important;
}

:deep(.p-datatable-tbody > tr > td) {
  padding: 1rem 1.5rem;
  background: transparent !important;
  border: none;
}

:deep(.p-checkbox .p-checkbox-box) {
  width: 1rem;
  height: 1rem;
  border-radius: 0.25rem;
  border-color: rgb(75, 85, 99);
  background: rgb(31, 41, 55);
}

:deep(.p-checkbox .p-checkbox-box.p-highlight) {
  border-color: rgb(37, 99, 235);
  background: rgb(37, 99, 235);
}

:deep(.p-checkbox .p-checkbox-box:hover) {
  border-color: rgb(59, 130, 246);
}
</style>
