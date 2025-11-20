<template>
  <header class="bg-[#0d1b2a] border-b border-gray-800 px-6 py-4">
    <div class="flex items-center justify-between">
      <!-- Left: Add Profile Button & Search -->
      <div class="flex items-center gap-4 flex-1">
        <button 
          @click="showCreateDialog = true"
          class="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
        >
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
          </svg>
          <span class="text-sm font-medium">Add Profile</span>
        </button>

        <div class="flex-1 max-w-md">
          <div class="relative">
            <svg class="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search by ID, Username, Clonezy..."
              class="w-full bg-gray-800 border border-gray-700 rounded-lg pl-10 pr-4 py-2 text-sm text-gray-300 placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>
      </div>

      <!-- Right: Notification & User Profile -->
      <div class="flex items-center gap-4">
        <button class="relative p-2 hover:bg-gray-800 rounded-lg transition-colors">
          <svg class="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>

        <button class="relative p-2 hover:bg-gray-800 rounded-lg transition-colors">
          <svg class="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
          </svg>
          <span class="absolute top-1.5 right-1.5 w-2 h-2 bg-blue-500 rounded-full"></span>
        </button>

        <div class="w-9 h-9 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center cursor-pointer hover:ring-2 hover:ring-blue-500 transition-all">
          <span class="text-sm font-bold text-white">U</span>
        </div>
      </div>
    </div>

    <!-- Create Profile Dialog -->
    <Dialog 
      v-model:visible="showCreateDialog" 
      modal 
      header="Create New Profile" 
      :style="{ width: '500px' }"
      :pt="{
        root: { class: 'bg-[#0d1b2a] border border-gray-800' },
        header: { class: 'bg-[#0d1b2a] border-b border-gray-800 text-white' },
        content: { class: 'bg-[#0d1b2a] text-white' },
        footer: { class: 'bg-[#0d1b2a] border-t border-gray-800' }
      }"
    >
      <div class="space-y-4">
        <div>
          <label class="block text-sm font-medium text-gray-400 mb-2">
            Profile Name
          </label>
          <InputText
            v-model="newProfileName"
            placeholder="Enter profile name"
            class="w-full bg-gray-800 border border-gray-700 text-white"
            @keyup.enter="handleCreateProfile"
            autofocus
          />
          <p class="text-xs text-gray-500 mt-2">
            This name will be used as the folder name for the Chrome profile.
          </p>
        </div>
      </div>

      <template #footer>
        <div class="flex justify-end gap-2">
          <Button 
            label="Cancel" 
            @click="showCreateDialog = false"
            text
            :pt="{
              root: { class: 'text-gray-400 hover:text-white' }
            }"
          />
          <Button 
            label="Create" 
            @click="handleCreateProfile"
            :loading="isCreating"
            :pt="{
              root: { class: 'bg-blue-600 hover:bg-blue-700 text-white' }
            }"
          />
        </div>
      </template>
    </Dialog>
  </header>
</template>

<script setup>
import { ref } from 'vue'
import { useToast } from 'primevue/usetoast'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import Button from 'primevue/button'
import { ProfileAPI } from '@/api/profile.js'

const toast = useToast()
const showCreateDialog = ref(false)
const newProfileName = ref('')
const isCreating = ref(false)

const emit = defineEmits(['profile-created'])

async function handleCreateProfile() {
  if (!newProfileName.value.trim()) {
    toast.add({
      severity: 'warn',
      summary: 'Validation Error',
      detail: 'Please enter a profile name',
      life: 3000
    })
    return
  }

  try {
    isCreating.value = true

    const result = await ProfileAPI.create(newProfileName.value.trim())

    if (result && result.profile) {
      toast.add({
        severity: 'success',
        summary: 'Profile Created',
        detail: `Profile "${result.profile.name}" created successfully`,
        life: 3000
      })

      // Reset form
      newProfileName.value = ''
      showCreateDialog.value = false

      // Emit event to refresh profiles list
      emit('profile-created', result.profile)
    }
  } catch (error) {
    console.error('Error creating profile:', error)
    toast.add({
      severity: 'error',
      summary: 'Create Failed',
      detail: error.message || 'Failed to create profile',
      life: 5000
    })
  } finally {
    isCreating.value = false
  }
}
</script>

