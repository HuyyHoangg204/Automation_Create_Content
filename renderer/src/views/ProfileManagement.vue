<template>
  <MainLayout>
    <Header @profile-created="handleProfileCreated" />
    
    <div class="flex-1 flex flex-col overflow-hidden">
      <!-- Table Header with Actions -->
      <div class="bg-[#0d1b2a] border-b border-gray-800 px-6 py-3 flex items-center justify-between">
        
        <div class="flex items-center gap-2">
          <button 
            v-for="action in quickActions" 
            :key="action.id"
            class="p-2 hover:bg-gray-800 rounded-lg transition-colors group"
            :title="action.label"
          >
            <component :is="action.icon" class="w-5 h-5 text-gray-400 group-hover:text-white" />
          </button>
        </div>
      </div>

      <!-- Profile Container -->
      <ProfileContainer ref="profileContainerRef" />
      
      <!-- Footer with Pagination -->
      <div class="bg-[#0d1b2a] border-t border-gray-800 px-6 py-3 flex items-center justify-between">
        <div class="flex items-center gap-4">
          <span class="text-sm text-gray-400">Rows per page:</span>
          <select class="bg-gray-800 border border-gray-700 rounded px-3 py-1 text-sm text-gray-300 focus:outline-none focus:border-blue-500">
            <option>10</option>
            <option>25</option>
            <option>50</option>
            <option>100</option>
          </select>
        </div>
        
        <div class="flex items-center gap-6">
          <span class="text-sm text-gray-400">1-6 of 6</span>
          <div class="flex items-center gap-1">
            <button 
              v-for="page in pages" 
              :key="page"
              :class="[
                'w-8 h-8 flex items-center justify-center rounded text-sm transition-colors',
                page === currentPage 
                  ? 'bg-blue-600 text-white' 
                  : 'text-gray-400 hover:bg-gray-800 hover:text-white'
              ]"
            >
              {{ page }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </MainLayout>
</template>

<script setup>
import { ref } from 'vue'

import MainLayout from '@/layouts/MainLayout.vue'
import Header from '@/components/Header.vue'
import ProfileContainer from '@/components/ProfileContainer.vue'

const currentPage = ref(1)
const pages = [1, 2, 3, 4, 5, 6]
const profileCount = ref(6)
const profileContainerRef = ref(null)

// Handle profile created event
function handleProfileCreated(profile) {
  console.log('Profile created:', profile)
  // Refresh profiles list
  if (profileContainerRef.value && profileContainerRef.value.loadProfiles) {
    profileContainerRef.value.loadProfiles()
  }
}

const quickActions = [
  { id: 'refresh', label: 'Refresh', icon: 'IconRefresh' },
  { id: 'filter', label: 'Filter', icon: 'IconFilter' },
  { id: 'sort', label: 'Sort', icon: 'IconSort' },
  { id: 'export', label: 'Export', icon: 'IconExport' },
]
</script>

<script>
const IconRefresh = {
  template: `
    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  `
}

const IconFilter = {
  template: `
    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
    </svg>
  `
}

const IconSort = {
  template: `
    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12" />
    </svg>
  `
}

const IconExport = {
  template: `
    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
    </svg>
  `
}

export default {
  components: {
    IconRefresh,
    IconFilter,
    IconSort,
    IconExport,
  }
}
</script>

